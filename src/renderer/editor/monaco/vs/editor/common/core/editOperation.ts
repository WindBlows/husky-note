/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { Range } from './range';
import { Position } from './position';
import { IIdentifiedSingleEditOperation } from '../model';

export class EditOperation {

	public static insert(position: Position, text: string): IIdentifiedSingleEditOperation {
		return {
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			text: text,
			forceMoveMarkers: true
		};
	}

	public static delete(range: Range): IIdentifiedSingleEditOperation {
		return {
			range: range,
			text: null
		};
	}

	public static replace(range: Range, text: string): IIdentifiedSingleEditOperation {
		return {
			range: range,
			text: text
		};
	}

	public static replaceMove(range: Range, text: string): IIdentifiedSingleEditOperation {
		return {
			range: range,
			text: text,
			forceMoveMarkers: true
		};
	}
}