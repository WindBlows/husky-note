/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { onUnexpectedError } from '../../../base/common/errors';
import * as mime from '../../../base/common/mime';
import * as strings from '../../../base/common/strings';
import { Registry } from '../../../platform/registry/common/platform';
import { ModesRegistry } from '../modes/modesRegistry';
import { ILanguageExtensionPoint } from './modeService';
import { LanguageId, LanguageIdentifier } from '../modes';
import { NULL_MODE_ID, NULL_LANGUAGE_IDENTIFIER } from '../modes/nullMode';
import { IConfigurationRegistry, Extensions } from '../../../platform/configuration/common/configurationRegistry';
import URI from '../../../base/common/uri';

const hasOwnProperty = Object.prototype.hasOwnProperty;

export interface IResolvedLanguage {
	identifier: LanguageIdentifier;
	name: string;
	mimetypes: string[];
	aliases: string[];
	extensions: string[];
	filenames: string[];
	configurationFiles: URI[];
}

export class LanguagesRegistry {

	private _nextLanguageId: number;
	private _languages: { [id: string]: IResolvedLanguage; };
	private _languageIds: string[];

	private _mimeTypesMap: { [mimeType: string]: LanguageIdentifier; };
	private _nameMap: { [name: string]: LanguageIdentifier; };
	private _lowercaseNameMap: { [name: string]: LanguageIdentifier; };

	private _warnOnOverwrite: boolean;

	constructor(useModesRegistry = true, warnOnOverwrite = false) {
		this._nextLanguageId = 1;
		this._languages = {};
		this._mimeTypesMap = {};
		this._nameMap = {};
		this._lowercaseNameMap = {};
		this._languageIds = [];
		this._warnOnOverwrite = warnOnOverwrite;

		if (useModesRegistry) {
			this._registerLanguages(ModesRegistry.getLanguages());
			ModesRegistry.onDidAddLanguages((m) => this._registerLanguages(m));
		}
	}

	_registerLanguages(desc: ILanguageExtensionPoint[]): void {
		if (desc.length === 0) {
			return;
		}

		for (let i = 0; i < desc.length; i++) {
			this._registerLanguage(desc[i]);
		}

		// Rebuild fast path maps
		this._mimeTypesMap = {};
		this._nameMap = {};
		this._lowercaseNameMap = {};
		Object.keys(this._languages).forEach((langId) => {
			let language = this._languages[langId];
			if (language.name) {
				this._nameMap[language.name] = language.identifier;
			}
			language.aliases.forEach((alias) => {
				this._lowercaseNameMap[alias.toLowerCase()] = language.identifier;
			});
			language.mimetypes.forEach((mimetype) => {
				this._mimeTypesMap[mimetype] = language.identifier;
			});
		});

		Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerOverrideIdentifiers(ModesRegistry.getLanguages().map(language => language.id));
	}

	private _registerLanguage(lang: ILanguageExtensionPoint): void {
		const langId = lang.id;

		let resolvedLanguage: IResolvedLanguage = null;
		if (hasOwnProperty.call(this._languages, langId)) {
			resolvedLanguage = this._languages[langId];
		} else {
			let languageId = this._nextLanguageId++;
			resolvedLanguage = {
				identifier: new LanguageIdentifier(langId, languageId),
				name: null,
				mimetypes: [],
				aliases: [],
				extensions: [],
				filenames: [],
				configurationFiles: []
			};
			this._languageIds[languageId] = langId;
			this._languages[langId] = resolvedLanguage;
		}

		this._mergeLanguage(resolvedLanguage, lang);
	}

	private _mergeLanguage(resolvedLanguage: IResolvedLanguage, lang: ILanguageExtensionPoint): void {
		const langId = lang.id;

		let primaryMime: string = null;

		if (Array.isArray(lang.mimetypes) && lang.mimetypes.length > 0) {
			resolvedLanguage.mimetypes.push(...lang.mimetypes);
			primaryMime = lang.mimetypes[0];
		}

		if (!primaryMime) {
			primaryMime = `text/x-${langId}`;
			resolvedLanguage.mimetypes.push(primaryMime);
		}

		if (Array.isArray(lang.extensions)) {
			for (let extension of lang.extensions) {
				mime.registerTextMime({ id: langId, mime: primaryMime, extension: extension }, this._warnOnOverwrite);
				resolvedLanguage.extensions.push(extension);
			}
		}

		if (Array.isArray(lang.filenames)) {
			for (let filename of lang.filenames) {
				mime.registerTextMime({ id: langId, mime: primaryMime, filename: filename }, this._warnOnOverwrite);
				resolvedLanguage.filenames.push(filename);
			}
		}

		if (Array.isArray(lang.filenamePatterns)) {
			for (let filenamePattern of lang.filenamePatterns) {
				mime.registerTextMime({ id: langId, mime: primaryMime, filepattern: filenamePattern }, this._warnOnOverwrite);
			}
		}

		if (typeof lang.firstLine === 'string' && lang.firstLine.length > 0) {
			let firstLineRegexStr = lang.firstLine;
			if (firstLineRegexStr.charAt(0) !== '^') {
				firstLineRegexStr = '^' + firstLineRegexStr;
			}
			try {
				let firstLineRegex = new RegExp(firstLineRegexStr);
				if (!strings.regExpLeadsToEndlessLoop(firstLineRegex)) {
					mime.registerTextMime({ id: langId, mime: primaryMime, firstline: firstLineRegex }, this._warnOnOverwrite);
				}
			} catch (err) {
				// Most likely, the regex was bad
				onUnexpectedError(err);
			}
		}

		resolvedLanguage.aliases.push(langId);

		let langAliases: string[] = null;
		if (typeof lang.aliases !== 'undefined' && Array.isArray(lang.aliases)) {
			if (lang.aliases.length === 0) {
				// signal that this language should not get a name
				langAliases = [null];
			} else {
				langAliases = lang.aliases;
			}
		}

		if (langAliases !== null) {
			for (let i = 0; i < langAliases.length; i++) {
				if (!langAliases[i] || langAliases[i].length === 0) {
					continue;
				}
				resolvedLanguage.aliases.push(langAliases[i]);
			}
		}

		let containsAliases = (langAliases !== null && langAliases.length > 0);
		if (containsAliases && langAliases[0] === null) {
			// signal that this language should not get a name
		} else {
			let bestName = (containsAliases ? langAliases[0] : null) || langId;
			if (containsAliases || !resolvedLanguage.name) {
				resolvedLanguage.name = bestName;
			}
		}

		if (lang.configuration) {
			resolvedLanguage.configurationFiles.push(lang.configuration);
		}
	}

	public isRegisteredMode(mimetypeOrModeId: string): boolean {
		// Is this a known mime type ?
		if (hasOwnProperty.call(this._mimeTypesMap, mimetypeOrModeId)) {
			return true;
		}
		// Is this a known mode id ?
		return hasOwnProperty.call(this._languages, mimetypeOrModeId);
	}

	public getModeIdForLanguageNameLowercase(languageNameLower: string): string {
		if (!hasOwnProperty.call(this._lowercaseNameMap, languageNameLower)) {
			return null;
		}
		return this._lowercaseNameMap[languageNameLower].language;
	}

	public extractModeIds(commaSeparatedMimetypesOrCommaSeparatedIds: string): string[] {
		if (!commaSeparatedMimetypesOrCommaSeparatedIds) {
			return [];
		}

		return (
			commaSeparatedMimetypesOrCommaSeparatedIds.
				split(',').
				map((mimeTypeOrId) => mimeTypeOrId.trim()).
				map((mimeTypeOrId) => {
					if (hasOwnProperty.call(this._mimeTypesMap, mimeTypeOrId)) {
						return this._mimeTypesMap[mimeTypeOrId].language;
					}
					return mimeTypeOrId;
				}).
				filter((modeId) => {
					return hasOwnProperty.call(this._languages, modeId);
				})
		);
	}

	public getLanguageIdentifier(_modeId: string | LanguageId): LanguageIdentifier {
		if (_modeId === NULL_MODE_ID || _modeId === LanguageId.Null) {
			return NULL_LANGUAGE_IDENTIFIER;
		}

		let modeId: string;
		if (typeof _modeId === 'string') {
			modeId = _modeId;
		} else {
			modeId = this._languageIds[_modeId];
			if (!modeId) {
				return null;
			}
		}

		if (!hasOwnProperty.call(this._languages, modeId)) {
			return null;
		}
		return this._languages[modeId].identifier;
	}

	public getModeIdsFromFilenameOrFirstLine(filename: string, firstLine?: string): string[] {
		if (!filename && !firstLine) {
			return [];
		}
		let mimeTypes = mime.guessMimeTypes(filename, firstLine);
		return this.extractModeIds(mimeTypes.join(','));
	}
}