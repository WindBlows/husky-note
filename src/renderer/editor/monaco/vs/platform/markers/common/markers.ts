/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import URI from '../../../base/common/uri';
import { Event } from '../../../base/common/event';
import { createDecorator } from '../../instantiation/common/instantiation';
import { localize } from '../../../nls';
import Severity from '../../../base/common/severity';

export interface IMarkerService {
	_serviceBrand: any;

	changeOne(owner: string, resource: URI, markers: IMarkerData[]): void;

	remove(owner: string, resources: URI[]): void;

	read(filter?: { owner?: string; resource?: URI; severities?: number, take?: number; }): IMarker[];

	onMarkerChanged: Event<URI[]>;
}

/**
 *
 */
export interface IRelatedInformation {
	resource: URI;
	message: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export enum MarkerTag {
	Unnecessary = 1,
}

export enum MarkerSeverity {
	Hint = 1,
	Info = 2,
	Warning = 4,
	Error = 8,
}

export namespace MarkerSeverity {

	export function compare(a: MarkerSeverity, b: MarkerSeverity): number {
		return b - a;
	}

	const _displayStrings: { [value: number]: string; } = Object.create(null);
	_displayStrings[MarkerSeverity.Error] = localize('sev.error', "Error");
	_displayStrings[MarkerSeverity.Warning] = localize('sev.warning', "Warning");
	_displayStrings[MarkerSeverity.Info] = localize('sev.info', "Info");

	export function toString(a: MarkerSeverity): string {
		return _displayStrings[a] || '';
	}

	export function fromSeverity(severity: Severity): MarkerSeverity {
		switch (severity) {
			case Severity.Error: return MarkerSeverity.Error;
			case Severity.Warning: return MarkerSeverity.Warning;
			case Severity.Info: return MarkerSeverity.Info;
			case Severity.Ignore: return MarkerSeverity.Hint;
		}
	}
}

/**
 * A structure defining a problem/warning/etc.
 */
export interface IMarkerData {
	code?: string;
	severity: MarkerSeverity;
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	relatedInformation?: IRelatedInformation[];
	tags?: MarkerTag[];
}

export interface IMarker {
	owner: string;
	resource: URI;
	severity: MarkerSeverity;
	code?: string;
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	relatedInformation?: IRelatedInformation[];
	tags?: MarkerTag[];
}

export interface MarkerStatistics {
	errors: number;
	warnings: number;
	infos: number;
	unknowns: number;
}

export namespace IMarkerData {
	const emptyString = '';
	export function makeKey(markerData: IMarkerData): string {
		let result: string[] = [emptyString];
		if (markerData.source) {
			result.push(markerData.source.replace('¦', '\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.code) {
			result.push(markerData.code.replace('¦', '\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.severity !== void 0 && markerData.severity !== null) {
			result.push(MarkerSeverity.toString(markerData.severity));
		} else {
			result.push(emptyString);
		}
		if (markerData.message) {
			result.push(markerData.message.replace('¦', '\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.startLineNumber !== void 0 && markerData.startLineNumber !== null) {
			result.push(markerData.startLineNumber.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.startColumn !== void 0 && markerData.startColumn !== null) {
			result.push(markerData.startColumn.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.endLineNumber !== void 0 && markerData.endLineNumber !== null) {
			result.push(markerData.endLineNumber.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.endColumn !== void 0 && markerData.endColumn !== null) {
			result.push(markerData.endColumn.toString());
		} else {
			result.push(emptyString);
		}
		result.push(emptyString);
		return result.join('¦');
	}
}

export const IMarkerService = createDecorator<IMarkerService>('markerService');