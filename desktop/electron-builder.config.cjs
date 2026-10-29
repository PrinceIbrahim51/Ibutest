/**
 * electron-builder configuration: Windows (.exe installer + portable), macOS (.dmg) and
 * Linux (AppImage/.deb). Build on each OS (see .github/workflows/desktop.yml).
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'com.ibutest.desktop',
  productName: 'IbuTest',
  executableName: 'ibutest',
  copyright: 'Copyright © IbuTest',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'package.json'],
  extraResources: [
    { from: '../client/dist', to: 'client' },
    { from: '../server/drizzle', to: 'migrations' },
  ],
  asar: true,
  // Native (argon2) and WebAssembly (PGlite) assets are loaded from disk.
  asarUnpack: ['**/node_modules/@node-rs/**', '**/node_modules/@electric-sql/pglite/**'],
  // Electron fuses: strip debugging/back-door features from the shipped binary.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64', 'arm64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    icon: 'build/icon.png',
    // Code signing: set CSC_LINK / CSC_KEY_PASSWORD (or Azure Trusted Signing) in CI secrets.
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    artifactName: 'IbuTest-Setup-${version}-${arch}.${ext}',
  },
  portable: { artifactName: 'IbuTest-Portable-${version}.${ext}' },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    category: 'public.app-category.developer-tools',
    icon: 'build/icon.png',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
  },
  linux: {
    executableName: 'ibutest',
    target: ['AppImage', 'deb'],
    category: 'Development',
    icon: 'build/icon.png',
    maintainer: 'IbuTest',
  },
  publish: null,
};
