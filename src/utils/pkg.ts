import fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { execa } from 'execa';
import type { JsonValue } from 'type-fest';
import validatePkgName from 'validate-npm-package-name';
import type { Position, TextDocument } from 'vscode';

import { NODE_MODULES, PACKAGE_JSON } from './constants';
import { pathExists } from './fs';
import { parseJsonc } from './jsonc';
import { getRoot } from './path';

export async function findPkgInstallDir(packageName: string, baseFilePath: string) {
    // maybe soft symbolic link
    baseFilePath = await fs.realpath(baseFilePath);

    let currentDirPath = dirname(baseFilePath);
    let pkgInstallDir = '';
    const endPath = getRoot(baseFilePath);

    while (true) {
        pkgInstallDir = resolve(currentDirPath, NODE_MODULES, packageName);
        const pkgJsonPath = resolve(pkgInstallDir, PACKAGE_JSON);

        // eslint-disable-next-line no-await-in-loop
        const pkgExists = await Promise.all([pathExists(pkgInstallDir), pathExists(pkgJsonPath)]);
        if (pkgExists.every(Boolean)) {
            return pkgInstallDir;
        }

        if (currentDirPath === endPath) {
            return;
        }

        currentDirPath = dirname(currentDirPath);
    }
}

export async function getPkgNameAndVersionFromDocPosition(
    document: TextDocument,
    position: Position,
) {
    const pkgJson = document.getText();
    const root = await parseJsonc(pkgJson);
    if (!root) return;

    const dependenciesNodePath = [
        'dependencies',
        'devDependencies',
        'peerDependencies',
        'optionalDependencies',
    ];

    const { findNodeAtOffset, findNodeAtLocation } = await import('jsonc-parser');
    const nameNode = findNodeAtOffset(root, document.offsetAt(position));
    if (!nameNode || !nameNode.parent) return;

    const dependenciesNodes = dependenciesNodePath.map((path) =>
        findNodeAtLocation(root, path.split('.')),
    );

    const versionNode = nameNode.parent.children![1];
    const isHoverOverDependency =
        nameNode.type === 'string' &&
        versionNode.type === 'string' &&
        nameNode.parent?.type === 'property' &&
        nameNode.parent.children?.length === 2 &&
        nameNode === nameNode.parent.children![0] &&
        dependenciesNodes.includes(nameNode.parent?.parent);
    if (!isHoverOverDependency) return;

    const pkgName = nameNode.value;
    if (!validatePkgName(pkgName).validForOldPackages) return;

    return {
        nameNode,
        versionNode,
        name: pkgName,
        version: versionNode.value!,
    };
}

/**
 * Ref: [vscode builtin npm extension npmView
 * implementation](https://github.com/microsoft/vscode/blob/main/extensions/npm/src/features/packageJSONContribution.ts#L285)
 */
export async function getPkgInfoFromNpmView<
    V extends JsonValue,
    const PA extends readonly string[] = readonly string[],
>(
    packageName: string,
    properties: PA,
    cwd: string,
): Promise<
    | (PA['length'] extends 1
          ? V
          : {
                [K in PA[number]]: V;
            })
    | undefined
> {
    try {
        const { stdout } = await execa('npm', ['view', '--json', packageName, ...properties], {
            cwd,
        });
        return JSON.parse(stdout);
    } catch {
        return undefined;
    }
}