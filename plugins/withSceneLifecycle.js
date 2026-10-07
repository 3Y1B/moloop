// Adopts the UIKit scene life cycle, which apps built with the iOS 27 SDK must use or they
// fail to launch. Expo ships the scene delegate (`ExpoAppSceneDelegate`, registered in ObjC as
// `EXExpoAppSceneDelegate`) but the SDK 57 template doesn't wire it up yet, so this plugin:
//   1. declares the scene manifest in Info.plist, pointing at Expo's scene delegate;
//   2. makes AppDelegate an `ExpoReactNativeFactoryProvider` so the scene delegate can start
//      React Native, and stops AppDelegate from creating its own window.
// Remove once `expo prebuild` generates this itself.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE = 'EXExpoAppSceneDelegate';

const WINDOW_BLOCK =
  /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneInfoPlist(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE,
          },
        ],
      },
    };
    return config;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle only supports a Swift AppDelegate');
    }
    let contents = config.modResults.contents;

    if (!contents.includes('ExpoReactNativeFactoryProvider')) {
      const declaration = 'class AppDelegate: ExpoAppDelegate {';
      if (!contents.includes(declaration)) {
        throw new Error(`withSceneLifecycle: couldn't find "${declaration}" in AppDelegate.swift`);
      }
      contents = contents.replace(
        declaration,
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
      );
    }

    // The scene delegate creates the window and starts React Native into it.
    contents = contents.replace(WINDOW_BLOCK, '');
    if (contents.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error("withSceneLifecycle: couldn't remove AppDelegate's window setup");
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withSceneLifecycle(config) {
  return withSceneAppDelegate(withSceneInfoPlist(config));
};
