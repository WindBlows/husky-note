/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { onUnexpectedError } from '../../../base/common/errors';
import { IDisposable } from '../../../base/common/lifecycle';
import * as dom from '../../../base/browser/dom';
import { FastDomNode, createFastDomNode } from '../../../base/browser/fastDomNode';
import { Range } from '../../common/core/range';
import { ViewEventHandler } from '../../common/viewModel/viewEventHandler';
import { IConfiguration } from '../../common/editorCommon';
import { TextAreaHandler, ITextAreaHandlerHelper } from '../controller/textAreaHandler';
import { PointerHandler } from '../controller/pointerHandler';
import * as editorBrowser from '../editorBrowser';
import { ViewController, ExecCoreEditorCommandFunc, ICommandDelegate } from './viewController';
import { ViewEventDispatcher } from '../../common/view/viewEventDispatcher';
import { ContentViewOverlays, MarginViewOverlays } from './viewOverlays';
import { ViewContentWidgets } from '../viewParts/contentWidgets/contentWidgets';
import { CurrentLineHighlightOverlay } from '../viewParts/currentLineHighlight/currentLineHighlight';
import { CurrentLineMarginHighlightOverlay } from '../viewParts/currentLineMarginHighlight/currentLineMarginHighlight';
import { DecorationsOverlay } from '../viewParts/decorations/decorations';
import { GlyphMarginOverlay } from '../viewParts/glyphMargin/glyphMargin';
import { LineNumbersOverlay } from '../viewParts/lineNumbers/lineNumbers';
import { IndentGuidesOverlay } from '../viewParts/indentGuides/indentGuides';
import { ViewLines } from '../viewParts/lines/viewLines';
import { Margin } from '../viewParts/margin/margin';
import { LinesDecorationsOverlay } from '../viewParts/linesDecorations/linesDecorations';
import { MarginViewLineDecorationsOverlay } from '../viewParts/marginDecorations/marginDecorations';
import { ViewOverlayWidgets } from '../viewParts/overlayWidgets/overlayWidgets';
import { DecorationsOverviewRuler } from '../viewParts/overviewRuler/decorationsOverviewRuler';
import { OverviewRuler } from '../viewParts/overviewRuler/overviewRuler';
import { Rulers } from '../viewParts/rulers/rulers';
import { ScrollDecorationViewPart } from '../viewParts/scrollDecoration/scrollDecoration';
import { SelectionsOverlay } from '../viewParts/selections/selections';
import { ViewCursors } from '../viewParts/viewCursors/viewCursors';
import { ViewZones } from '../viewParts/viewZones/viewZones';
import { ViewPart, PartFingerprint, PartFingerprints } from './viewPart';
import { ViewContext } from '../../common/view/viewContext';
import { IViewModel } from '../../common/viewModel/viewModel';
import { RenderingContext } from '../../common/view/renderingContext';
import { IPointerHandlerHelper } from '../controller/mouseHandler';
import { ViewOutgoingEvents } from './viewOutgoingEvents';
import { ViewportData } from '../../common/viewLayout/viewLinesViewportData';
import { EditorScrollbar } from '../viewParts/editorScrollbar/editorScrollbar';
import { Minimap } from '../viewParts/minimap/minimap';
import * as viewEvents from '../../common/view/viewEvents';
import { IThemeService, getThemeTypeSelector } from '../../../platform/theme/common/themeService';
import { Cursor } from '../../common/controller/cursor';
import { IMouseEvent } from '../../../base/browser/mouseEvent';

export interface IContentWidgetData {
	widget: editorBrowser.IContentWidget;
	position: editorBrowser.IContentWidgetPosition;
}

export interface IOverlayWidgetData {
	widget: editorBrowser.IOverlayWidget;
	position: editorBrowser.IOverlayWidgetPosition;
}

export class View extends ViewEventHandler {

	private eventDispatcher: ViewEventDispatcher;

	private _scrollbar: EditorScrollbar;
	private _context: ViewContext;
	private _cursor: Cursor;

	// The view lines
	private viewLines: ViewLines;

	// These are parts, but we must do some API related calls on them, so we keep a reference
	private viewZones: ViewZones;
	private contentWidgets: ViewContentWidgets;
	private overlayWidgets: ViewOverlayWidgets;
	private viewCursors: ViewCursors;
	private viewParts: ViewPart[];

	private readonly _textAreaHandler: TextAreaHandler;
	private readonly pointerHandler: PointerHandler;

	private readonly outgoingEvents: ViewOutgoingEvents;

	// Dom nodes
	private linesContent: FastDomNode<HTMLElement>;
	public domNode: FastDomNode<HTMLElement>;
	private overflowGuardContainer: FastDomNode<HTMLElement>;

	// Actual mutable state
	private _renderAnimationFrame: IDisposable;

	constructor(
		commandDelegate: ICommandDelegate,
		configuration: IConfiguration,
		themeService: IThemeService,
		model: IViewModel,
		cursor: Cursor,
		execCoreEditorCommandFunc: ExecCoreEditorCommandFunc
	) {
		super();
		this._cursor = cursor;
		this._renderAnimationFrame = null;
		this.outgoingEvents = new ViewOutgoingEvents(model);

		let viewController = new ViewController(configuration, model, execCoreEditorCommandFunc, this.outgoingEvents, commandDelegate);

		// The event dispatcher will always go through _renderOnce before dispatching any events
		this.eventDispatcher = new ViewEventDispatcher((callback: () => void) => this._renderOnce(callback));

		// Ensure the view is the first event handler in order to update the layout
		this.eventDispatcher.addEventHandler(this);

		// The view context is passed on to most classes (basically to reduce param. counts in ctors)
		this._context = new ViewContext(configuration, themeService.getTheme(), model, this.eventDispatcher);

		this._register(themeService.onThemeChange(theme => {
			this._context.theme = theme;
			this.eventDispatcher.emit(new viewEvents.ViewThemeChangedEvent());
			this.render(true, false);
		}));

		this.viewParts = [];

		// Keyboard handler
		this._textAreaHandler = new TextAreaHandler(this._context, viewController, this.createTextAreaHandlerHelper());
		this.viewParts.push(this._textAreaHandler);

		this.createViewParts();
		this._setLayout();

		// Pointer handler
		this.pointerHandler = new PointerHandler(this._context, viewController, this.createPointerHandlerHelper());

		this._register(model.addEventListener((events: viewEvents.ViewEvent[]) => {
			this.eventDispatcher.emitMany(events);
		}));

		this._register(this._cursor.addEventListener((events: viewEvents.ViewEvent[]) => {
			this.eventDispatcher.emitMany(events);
		}));
	}

	private createViewParts(): void {
		// These two dom nodes must be constructed up front, since references are needed in the layout provider (scrolling & co.)
		this.linesContent = createFastDomNode(document.createElement('div'));
		this.linesContent.setClassName('lines-content' + ' monaco-editor-background');
		this.linesContent.setPosition('absolute');

		this.domNode = createFastDomNode(document.createElement('div'));
		this.domNode.setClassName(this.getEditorClassName());

		this.overflowGuardContainer = createFastDomNode(document.createElement('div'));
		PartFingerprints.write(this.overflowGuardContainer, PartFingerprint.OverflowGuard);
		this.overflowGuardContainer.setClassName('overflow-guard');

		this._scrollbar = new EditorScrollbar(this._context, this.linesContent, this.domNode, this.overflowGuardContainer);
		this.viewParts.push(this._scrollbar);

		// View Lines
		this.viewLines = new ViewLines(this._context, this.linesContent);

		// View Zones
		this.viewZones = new ViewZones(this._context);
		this.viewParts.push(this.viewZones);

		// Decorations overview ruler
		let decorationsOverviewRuler = new DecorationsOverviewRuler(this._context);
		this.viewParts.push(decorationsOverviewRuler);


		let scrollDecoration = new ScrollDecorationViewPart(this._context);
		this.viewParts.push(scrollDecoration);

		let contentViewOverlays = new ContentViewOverlays(this._context);
		this.viewParts.push(contentViewOverlays);
		contentViewOverlays.addDynamicOverlay(new CurrentLineHighlightOverlay(this._context));
		contentViewOverlays.addDynamicOverlay(new SelectionsOverlay(this._context));
		contentViewOverlays.addDynamicOverlay(new IndentGuidesOverlay(this._context));
		contentViewOverlays.addDynamicOverlay(new DecorationsOverlay(this._context));

		let marginViewOverlays = new MarginViewOverlays(this._context);
		this.viewParts.push(marginViewOverlays);
		marginViewOverlays.addDynamicOverlay(new CurrentLineMarginHighlightOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new GlyphMarginOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new MarginViewLineDecorationsOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new LinesDecorationsOverlay(this._context));
		marginViewOverlays.addDynamicOverlay(new LineNumbersOverlay(this._context));

		let margin = new Margin(this._context);
		margin.getDomNode().appendChild(this.viewZones.marginDomNode);
		margin.getDomNode().appendChild(marginViewOverlays.getDomNode());
		this.viewParts.push(margin);

		// Content widgets
		this.contentWidgets = new ViewContentWidgets(this._context, this.domNode);
		this.viewParts.push(this.contentWidgets);

		this.viewCursors = new ViewCursors(this._context);
		this.viewParts.push(this.viewCursors);

		// Overlay widgets
		this.overlayWidgets = new ViewOverlayWidgets(this._context);
		this.viewParts.push(this.overlayWidgets);

		let rulers = new Rulers(this._context);
		this.viewParts.push(rulers);

		let minimap = new Minimap(this._context);
		this.viewParts.push(minimap);

		// -------------- Wire dom nodes up

		if (decorationsOverviewRuler) {
			let overviewRulerData = this._scrollbar.getOverviewRulerLayoutInfo();
			overviewRulerData.parent.insertBefore(decorationsOverviewRuler.getDomNode(), overviewRulerData.insertBefore);
		}

		this.linesContent.appendChild(contentViewOverlays.getDomNode());
		this.linesContent.appendChild(rulers.domNode);
		this.linesContent.appendChild(this.viewZones.domNode);
		this.linesContent.appendChild(this.viewLines.getDomNode());
		this.linesContent.appendChild(this.contentWidgets.domNode);
		this.linesContent.appendChild(this.viewCursors.getDomNode());
		this.overflowGuardContainer.appendChild(margin.getDomNode());
		this.overflowGuardContainer.appendChild(this._scrollbar.getDomNode());
		this.overflowGuardContainer.appendChild(scrollDecoration.getDomNode());
		this.overflowGuardContainer.appendChild(this._textAreaHandler.textArea);
		this.overflowGuardContainer.appendChild(this._textAreaHandler.textAreaCover);
		this.overflowGuardContainer.appendChild(this.overlayWidgets.getDomNode());
		this.overflowGuardContainer.appendChild(minimap.getDomNode());
		this.domNode.appendChild(this.overflowGuardContainer);
		this.domNode.appendChild(this.contentWidgets.overflowingContentWidgetsDomNode);
	}

	private _flushAccumulatedAndRenderNow(): void {
		this._renderNow();
	}

	private createPointerHandlerHelper(): IPointerHandlerHelper {
		return {
			viewDomNode: this.domNode.domNode,
			linesContentDomNode: this.linesContent.domNode,

			focusTextArea: () => {
				this.focus();
			},

			getLastViewCursorsRenderData: () => {
				return this.viewCursors.getLastRenderData() || [];
			},
			shouldSuppressMouseDownOnViewZone: (viewZoneId: number) => {
				return this.viewZones.shouldSuppressMouseDownOnViewZone(viewZoneId);
			},
			shouldSuppressMouseDownOnWidget: (widgetId: string) => {
				return this.contentWidgets.shouldSuppressMouseDownOnWidget(widgetId);
			},
			getPositionFromDOMInfo: (spanNode: HTMLElement, offset: number) => {
				this._flushAccumulatedAndRenderNow();
				return this.viewLines.getPositionFromDOMInfo(spanNode, offset);
			},

			visibleRangeForPosition2: (lineNumber: number, column: number) => {
				this._flushAccumulatedAndRenderNow();
				let visibleRanges = this.viewLines.visibleRangesForRange2(new Range(lineNumber, column, lineNumber, column));
				if (!visibleRanges) {
					return null;
				}
				return visibleRanges[0];
			},

			getLineWidth: (lineNumber: number) => {
				this._flushAccumulatedAndRenderNow();
				return this.viewLines.getLineWidth(lineNumber);
			}
		};
	}

	private createTextAreaHandlerHelper(): ITextAreaHandlerHelper {
		return {
			visibleRangeForPositionRelativeToEditor: (lineNumber: number, column: number) => {
				this._flushAccumulatedAndRenderNow();
				let visibleRanges = this.viewLines.visibleRangesForRange2(new Range(lineNumber, column, lineNumber, column));
				if (!visibleRanges) {
					return null;
				}
				return visibleRanges[0];
			}
		};
	}

	private _setLayout(): void {
		const layoutInfo = this._context.configuration.editor.layoutInfo;
		this.domNode.setWidth(layoutInfo.width);
		this.domNode.setHeight(layoutInfo.height);

		this.overflowGuardContainer.setWidth(layoutInfo.width);
		this.overflowGuardContainer.setHeight(layoutInfo.height);

		this.linesContent.setWidth(1000000);
		this.linesContent.setHeight(1000000);

	}

	private getEditorClassName() {
		let focused = this._textAreaHandler.isFocused() ? ' focused' : '';
		return this._context.configuration.editor.editorClassName + ' ' + getThemeTypeSelector(this._context.theme.type) + focused;
	}

	// --- begin event handlers

	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		if (e.editorClassName) {
			this.domNode.setClassName(this.getEditorClassName());
		}
		if (e.layoutInfo) {
			this._setLayout();
		}
		return false;
	}
	public onFocusChanged(e: viewEvents.ViewFocusChangedEvent): boolean {
		this.domNode.setClassName(this.getEditorClassName());
		this._context.model.setHasFocus(e.isFocused);
		if (e.isFocused) {
			this.outgoingEvents.emitViewFocusGained();
		} else {
			this.outgoingEvents.emitViewFocusLost();
		}
		return false;
	}
	public onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		this.outgoingEvents.emitScrollChanged(e);
		return false;
	}
	public onThemeChanged(e: viewEvents.ViewThemeChangedEvent): boolean {
		this.domNode.setClassName(this.getEditorClassName());
		return false;
	}

	// --- end event handlers

	public dispose(): void {
		if (this._renderAnimationFrame !== null) {
			this._renderAnimationFrame.dispose();
			this._renderAnimationFrame = null;
		}

		this.eventDispatcher.removeEventHandler(this);
		this.outgoingEvents.dispose();

		this.pointerHandler.dispose();

		this.viewLines.dispose();

		// Destroy view parts
		for (let i = 0, len = this.viewParts.length; i < len; i++) {
			this.viewParts[i].dispose();
		}
		this.viewParts = [];

		super.dispose();
	}

	private _renderOnce(callback: () => any): any {
		let r = safeInvokeNoArg(callback);
		this._scheduleRender();
		return r;
	}

	private _scheduleRender(): void {
		if (this._renderAnimationFrame === null) {
			this._renderAnimationFrame = dom.runAtThisOrScheduleAtNextAnimationFrame(this._onRenderScheduled.bind(this), 100);
		}
	}

	private _onRenderScheduled(): void {
		this._renderAnimationFrame = null;
		this._flushAccumulatedAndRenderNow();
	}

	private _renderNow(): void {
		safeInvokeNoArg(() => this._actualRender());
	}

	private _getViewPartsToRender(): ViewPart[] {
		let result: ViewPart[] = [], resultLen = 0;
		for (let i = 0, len = this.viewParts.length; i < len; i++) {
			let viewPart = this.viewParts[i];
			if (viewPart.shouldRender()) {
				result[resultLen++] = viewPart;
			}
		}
		return result;
	}

	private _actualRender(): void {
		if (!dom.isInDOM(this.domNode.domNode)) {
			return;
		}

		let viewPartsToRender = this._getViewPartsToRender();

		if (!this.viewLines.shouldRender() && viewPartsToRender.length === 0) {
			// Nothing to render
			return;
		}

		const partialViewportData = this._context.viewLayout.getLinesViewportData();
		this._context.model.setViewport(partialViewportData.startLineNumber, partialViewportData.endLineNumber, partialViewportData.centeredLineNumber);

		let viewportData = new ViewportData(
			this._cursor.getViewSelections(),
			partialViewportData,
			this._context.viewLayout.getWhitespaceViewportData(),
			this._context.model
		);

		if (this.contentWidgets.shouldRender()) {
			// Give the content widgets a chance to set their max width before a possible synchronous layout
			this.contentWidgets.onBeforeRender(viewportData);
		}

		if (this.viewLines.shouldRender()) {
			this.viewLines.renderText(viewportData);
			this.viewLines.onDidRender();

			// Rendering of viewLines might cause scroll events to occur, so collect view parts to render again
			viewPartsToRender = this._getViewPartsToRender();
		}

		let renderingContext = new RenderingContext(this._context.viewLayout, viewportData, this.viewLines);

		// Render the rest of the parts
		for (let i = 0, len = viewPartsToRender.length; i < len; i++) {
			let viewPart = viewPartsToRender[i];
			viewPart.prepareRender(renderingContext);
		}

		for (let i = 0, len = viewPartsToRender.length; i < len; i++) {
			let viewPart = viewPartsToRender[i];
			viewPart.render(renderingContext);
			viewPart.onDidRender();
		}
	}

	// --- BEGIN CodeEditor helpers

	public delegateVerticalScrollbarMouseDown(browserEvent: IMouseEvent): void {
		this._scrollbar.delegateVerticalScrollbarMouseDown(browserEvent);
	}

	public restoreState(scrollPosition: { scrollLeft: number; scrollTop: number; }): void {
		this._context.viewLayout.setScrollPositionNow({ scrollTop: scrollPosition.scrollTop });
		this._renderNow();
		this.viewLines.updateLineWidths();
		this._context.viewLayout.setScrollPositionNow({ scrollLeft: scrollPosition.scrollLeft });
	}

	public getOffsetForColumn(modelLineNumber: number, modelColumn: number): number {
		let modelPosition = this._context.model.validateModelPosition({
			lineNumber: modelLineNumber,
			column: modelColumn
		});
		let viewPosition = this._context.model.coordinatesConverter.convertModelPositionToViewPosition(modelPosition);
		this._flushAccumulatedAndRenderNow();
		let visibleRanges = this.viewLines.visibleRangesForRange2(new Range(viewPosition.lineNumber, viewPosition.column, viewPosition.lineNumber, viewPosition.column));
		if (!visibleRanges) {
			return -1;
		}
		return visibleRanges[0].left;
	}

	public getTargetAtClientPoint(clientX: number, clientY: number): editorBrowser.IMouseTarget {
		return this.pointerHandler.getTargetAtClientPoint(clientX, clientY);
	}

	public getInternalEventBus(): ViewOutgoingEvents {
		return this.outgoingEvents;
	}

	public createOverviewRuler(cssClassName: string): OverviewRuler {
		return new OverviewRuler(this._context, cssClassName);
	}

	public change(callback: (changeAccessor: editorBrowser.IViewZoneChangeAccessor) => any): boolean {
		let zonesHaveChanged = false;

		this._renderOnce(() => {
			let changeAccessor: editorBrowser.IViewZoneChangeAccessor = {
				addZone: (zone: editorBrowser.IViewZone): number => {
					zonesHaveChanged = true;
					return this.viewZones.addZone(zone);
				},
				removeZone: (id: number): void => {
					if (!id) {
						return;
					}
					zonesHaveChanged = this.viewZones.removeZone(id) || zonesHaveChanged;
				},
				layoutZone: (id: number): void => {
					if (!id) {
						return;
					}
					zonesHaveChanged = this.viewZones.layoutZone(id) || zonesHaveChanged;
				}
			};

			safeInvoke1Arg(callback, changeAccessor);

			// Invalidate changeAccessor
			changeAccessor.addZone = null;
			changeAccessor.removeZone = null;

			if (zonesHaveChanged) {
				this._context.viewLayout.onHeightMaybeChanged();
				this._context.privateViewEventBus.emit(new viewEvents.ViewZonesChangedEvent());
			}
		});
		return zonesHaveChanged;
	}

	public render(now: boolean, everything: boolean): void {
		if (everything) {
			// Force everything to render...
			this.viewLines.forceShouldRender();
			for (let i = 0, len = this.viewParts.length; i < len; i++) {
				let viewPart = this.viewParts[i];
				viewPart.forceShouldRender();
			}
		}
		if (now) {
			this._flushAccumulatedAndRenderNow();
		} else {
			this._scheduleRender();
		}
	}

	public focus(): void {
		this._textAreaHandler.focusTextArea();
	}

	public isFocused(): boolean {
		return this._textAreaHandler.isFocused();
	}

	public addContentWidget(widgetData: IContentWidgetData): void {
		this.contentWidgets.addWidget(widgetData.widget);
		this.layoutContentWidget(widgetData);
		this._scheduleRender();
	}

	public layoutContentWidget(widgetData: IContentWidgetData): void {
		let newPosition = widgetData.position ? widgetData.position.position : null;
		let newPreference = widgetData.position ? widgetData.position.preference : null;
		this.contentWidgets.setWidgetPosition(widgetData.widget, newPosition, newPreference);
		this._scheduleRender();
	}

	public removeContentWidget(widgetData: IContentWidgetData): void {
		this.contentWidgets.removeWidget(widgetData.widget);
		this._scheduleRender();
	}

	public addOverlayWidget(widgetData: IOverlayWidgetData): void {
		this.overlayWidgets.addWidget(widgetData.widget);
		this.layoutOverlayWidget(widgetData);
		this._scheduleRender();
	}

	public layoutOverlayWidget(widgetData: IOverlayWidgetData): void {
		let newPreference = widgetData.position ? widgetData.position.preference : null;
		let shouldRender = this.overlayWidgets.setWidgetPosition(widgetData.widget, newPreference);
		if (shouldRender) {
			this._scheduleRender();
		}
	}

	public removeOverlayWidget(widgetData: IOverlayWidgetData): void {
		this.overlayWidgets.removeWidget(widgetData.widget);
		this._scheduleRender();
	}

	// --- END CodeEditor helpers

}

function safeInvokeNoArg(func: Function): any {
	try {
		return func();
	} catch (e) {
		onUnexpectedError(e);
	}
}

function safeInvoke1Arg(func: Function, arg1: any): any {
	try {
		return func(arg1);
	} catch (e) {
		onUnexpectedError(e);
	}
}