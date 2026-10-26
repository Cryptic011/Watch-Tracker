# Open Watched Tracker in Xcode

This is a new iOS app made from Cryptic011/Watched-Tracker. The existing tracking screens and account/library sync run inside Capacitor's native WebKit container. Native Swift adds iPhone local release reminders, notification links and backup sharing. The app screens are bundled, rather than downloaded from GitHub Pages on launch.

## Run on your Mac

1. Open `ios/App/App.xcodeproj` in Xcode 26 or newer. Keep the whole project folder together.
2. Let Xcode download the pinned Capacitor Swift package on the first open.
3. Choose **App**, then an **iPhone simulator**, in the top toolbar.
4. Click **Run ▶︎** or press **Command-R**.

The supplied project includes its web assets, so opening the supplied folder in Xcode doesn't require a terminal or npm. An internet connection is needed for the first package download. The app supports iOS 15 or newer.

## Install on your iPhone

1. In **Xcode → Settings → Apple Accounts**, sign in with your Apple Account.
2. Click the blue project icon, choose the **App** target, then **Signing & Capabilities**.
3. Enable **Automatically manage signing** and choose your **Team**. If needed, give the app a unique Bundle Identifier.
4. Connect and unlock your iPhone, trust your Mac, and enable **Developer Mode** on the phone if prompted.
5. Choose your iPhone in the toolbar and click **Run ▶︎**.

Xcode installs the app and its icon on your phone. A personal Apple Account supports testing on your own device; signing has limits and may need renewal. TestFlight distribution requires Apple Developer Program membership.

Sign in using your existing Watched Logger email and PIN. Browser storage is separate from the native app; synced titles arrive after sign-in. Unsynced browser edits need syncing in the website first. No real account credentials are included in this project.

## How future updates reach the phone

**Code change → GitHub push → Xcode Cloud build → TestFlight → iPhone automatic update.**

That delivery pipeline is not connected yet. Follow `UPDATE-SETUP.md` once using your Apple Developer account. For apps installed directly from Xcode, run the new build from Xcode again. A GitHub push alone doesn't update an installed native app.

Saved titles and watch progress continue syncing through the existing cloud service. They don't need a new app release. Native code and bundled screen changes need a new signed build.

## Development

Use Node.js 24, then:

```sh
npm ci
npm run ios:sync
```

This builds `www/` from the current website files and native adapter, then copies it into the Xcode project. Run it after every web-code change before a local Xcode build. Commit the source, native project and generated `ios/App/App/public/` folder together. `www/` and `node_modules/` remain generated.

The original website deployment and backend remain separate. This project does not deploy database changes or replace the existing website.

## Reminders and offline use

- Enable iPhone reminders in the app's existing reminder settings. iOS prompts for permission only after you tap Enable.
- The next 60 confirmed, future alerts are scheduled locally, at one day before, six hours before and release time. Date-only and unconfirmed streaming times are excluded. Weekly Releases opt-outs and archived titles are excluded.
- Open the app online to refresh release times and schedule later alerts. These are local notifications, not the website's server push service. Changes made on another device cannot alter this phone's pending reminders until the app syncs. Signing out cancels this app's local reminders.
- The included app shell and cached library work offline after initial sign-in. First sign-in, catalogue search and cloud sync need the network.
- Export Backup opens the iOS share sheet, including Save to Files. Restore Backup uses the existing JSON import and duplicate checks.

## Apple references

- [Run on a simulator or device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
- [Configure Xcode Cloud](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow/)
- [Deliver Xcode Cloud builds through TestFlight](https://developer.apple.com/documentation/xcode/distributing-your-xcode-cloud-builds-through-testflight)
- [TestFlight automatic updates and build expiry](https://testflight.apple.com/)

An App Store release needs separate privacy information, screenshots, account access for review and Apple's review. This starter has not been submitted or approved. Apple evaluates whether the finished app offers adequate iOS functionality.

## Native navigation and search

Library and Settings stay anchored outside the scrolling web view. The bottom-right magnifying glass and Library search bar open a full-page Search view. Search appears temporarily in the bottom island while that page is open, and disappears when you leave it. Editing and detail sheets hide the dock. The dock follows the keyboard when typing.
