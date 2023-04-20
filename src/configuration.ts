import vscode, { ConfigurationTarget } from 'vscode';

interface Configuration {
    enablePnpmWorkspaceCodeLens: boolean;
    enablePackageJsonFilesCodeLens: boolean;
    packageJsonFilesCodeLens: {
        includeDefaultPackedFiles: boolean;
    };
    enablePackageJsonDependenciesCodeLens: boolean;
    packageJsonDependenciesCodeLens: {
        dependenciesNodePaths: string[];
        searchDependenciesFileExtensions: string[];
        searchDependenciesExcludePatterns: string[];
    };

    togglePackageJsonDependenciesCodeLens(): Thenable<void>;
}

export const configuration: Configuration = {
    togglePackageJsonDependenciesCodeLens() {
        return vscode.workspace
            .getConfiguration()
            .update(
                'package-manager-enhancer.enablePackageJsonDependenciesCodeLens',
                !configuration.enablePackageJsonDependenciesCodeLens,
                ConfigurationTarget.Global,
            );
    },
} as Configuration;
updateConfiguration();

export function updateConfiguration() {
    const extensionConfig = vscode.workspace.getConfiguration('package-manager-enhancer');

    configuration.enablePnpmWorkspaceCodeLens = extensionConfig.get('enablePnpmWorkspaceCodeLens')!;

    configuration.enablePackageJsonFilesCodeLens = extensionConfig.get(
        'enablePackageJsonFilesCodeLens',
    )!;
    configuration.packageJsonFilesCodeLens = extensionConfig.get(
        'packageJsonFilesCodeLens',
    ) as Configuration['packageJsonFilesCodeLens'];

    configuration.enablePackageJsonDependenciesCodeLens = extensionConfig.get(
        'enablePackageJsonDependenciesCodeLens',
    )!;
    configuration.packageJsonDependenciesCodeLens = extensionConfig.get(
        'packageJsonDependenciesCodeLens',
    ) as Configuration['packageJsonDependenciesCodeLens'];
}