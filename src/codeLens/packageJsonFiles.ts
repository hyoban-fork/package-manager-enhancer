import { dirname, resolve } from 'node:path';

import type { CancellationToken, ExtensionContext, TextDocument } from 'vscode';
import { CodeLens, Range } from 'vscode';

import { configuration, configurationKeys } from '../configuration';
import { pathExists } from '../utils/fs';
import { jsoncStringNodeToRange, parseJsonc } from '../utils/jsonc';
import { GlobCodeLensProvider } from './GlobCodeLensProvider';

const filesLiteral = 'files';

// refs:
// 1. https://docs.npmjs.com/cli/v9/configuring-npm/package-json#files
// 2. https://github.com/npm/npm-packlist
const defaultIncludedFiles = ['package.json', 'README.md', 'LICENSE.md', 'LICENCE.md'];
const defaultIgnoredPatterns = [
    'node_modules',
    'package-lock.json',
    '**/.gitignore',
    '**/.npmignore',
    '**/npm-debug.log',
    '**/.npmrc',
    '**/.git',
    '**/CVS',
    '**/.svn',
    '**/.hg',
    '**/.lock-wscript',
    '**/.wafpickle-N',
    '**/.*.swp',
    '**/.DS_Store',
    '**/._*',
    '**/config.gypi',
    '**/*.orig',
].map((p) => `!${p}`);

export class PackageJsonFilesCodeLensProvider extends GlobCodeLensProvider {
    constructor(context: ExtensionContext) {
        super(
            context,
            () => configuration.enablePackageJsonFilesCodeLens,
            (e) =>
                e.affectsConfiguration(configurationKeys.enablePackageJsonFilesCodeLens) ||
                e.affectsConfiguration(configurationKeys.packageJsonFilesCodeLens._key),
        );
    }

    async getCodeLenses(
        document: TextDocument,
        _token: CancellationToken,
    ): Promise<CodeLens[] | undefined> {
        super.getCodeLenses(document, _token);

        const { globby } = await import('globby');
        const { findNodeAtLocation } = await import('jsonc-parser');

        const packageJson = document.getText();
        const root = await parseJsonc(packageJson);
        if (!root) return;

        const filesPropertyNode = findNodeAtLocation(root, ['files']);
        if (
            !filesPropertyNode ||
            !filesPropertyNode.children ||
            filesPropertyNode.children.length === 0
        )
            return;

        const patternList: Array<{
            isNegated: boolean;
            pattern: string;
            range: Range;
        }> = [];
        for (const patternNode of filesPropertyNode.children) {
            if (patternNode.type !== 'string') return;

            const pattern = patternNode.value as string;
            const range = jsoncStringNodeToRange(document, patternNode);
            const isNegated = pattern.startsWith('!');
            if (isNegated) {
                this._negativePatterns.push(pattern);
            }
            patternList.push({
                isNegated,
                pattern,
                range,
            });
        }

        const totalFiles: Set<string> = new Set();
        const codeLensList: CodeLens[] = [];
        const promises: Array<Promise<string[]>> = [];
        const cwd = dirname(document.uri.fsPath);
        for (const item of patternList) {
            const codeLens = new CodeLens(item.range);
            codeLensList.push(codeLens);

            const patterns = item.isNegated
                ? [item.pattern.slice(1)]
                : [item.pattern, ...this._negativePatterns];
            const promise = (async () => {
                const relativeFiles = await globby([...patterns, ...defaultIgnoredPatterns], {
                    cwd,
                    dot: true,
                    onlyFiles: true,
                    followSymbolicLinks: false,
                    // any top level .gitignore and .npmignore will be ignore, but nest will be used
                    // https://github.com/npm/npm-packlist#interaction-between-packagejson-and-npmignore-rules
                    gitignore: false,
                    ignoreFiles: ['*/**/.npmignore, */**/.gitignore'],
                });
                return relativeFiles.map((file) => {
                    const absFile = resolve(cwd, file);
                    if (!item.isNegated) {
                        totalFiles.add(absFile);
                    }
                    return absFile;
                });
            })();
            if (!item.isNegated) {
                promises.push(promise);
            }
            this._codeLensDataMap.set(codeLens, {
                type: item.isNegated ? 'exclude' : 'include',
                position: item.range.start,
                getReferenceFilesPromise: promise,
            });
        }

        const start = document.positionAt(filesPropertyNode.offset);
        const end = document.positionAt(filesPropertyNode.offset + filesLiteral.length);
        const codelens = new CodeLens(new Range(start, end));
        codeLensList.push(codelens);
        this._codeLensDataMap.set(codelens, {
            type: 'all',
            position: start,
            getReferenceFilesPromise: (async () => {
                await Promise.all(promises);

                if (!configuration.packageJsonFilesCodeLens.includeDefaultPackedFiles) {
                    return [...totalFiles];
                }

                /**
                 * Default included files
                 */
                const addFileWhenExists = async (absPath: string) => {
                    if (await pathExists(absPath)) {
                        totalFiles.add(absPath);
                        return true;
                    }
                    return false;
                };

                for (const file of defaultIncludedFiles) {
                    const absPath = resolve(cwd, file);
                    if (absPath.endsWith('.md')) {
                        const absPathWithoutExtension = resolve(cwd, file.slice(0, -3));
                        const lowercaseAbsPath = resolve(cwd, file.toLowerCase());
                        const lowercaseAbsPathWithoutExtension = resolve(
                            cwd,
                            file.toLowerCase().slice(0, -3),
                        );
                        const candidates = [
                            absPath,
                            absPathWithoutExtension,
                            lowercaseAbsPath,
                            lowercaseAbsPathWithoutExtension,
                        ];
                        for (const p of candidates) {
                            // eslint-disable-next-line no-await-in-loop
                            if (await addFileWhenExists(p)) break;
                        }
                    } else {
                        // eslint-disable-next-line no-await-in-loop
                        await addFileWhenExists(absPath);
                    }
                }

                // main entry must be included
                const mainProperty = findNodeAtLocation(root, ['main']);
                if (
                    mainProperty &&
                    mainProperty.type === 'property' &&
                    mainProperty.children![0].type === 'string' &&
                    mainProperty.children![0].type === 'string'
                ) {
                    const mainEntry = resolve(cwd, mainProperty.value);
                    await addFileWhenExists(mainEntry);
                }

                return [...totalFiles];
            })(),
        });

        return codeLensList;
    }

    getTitleFormat(): string {
        return configuration.packageJsonFilesCodeLens.titleFormat;
    }
}
