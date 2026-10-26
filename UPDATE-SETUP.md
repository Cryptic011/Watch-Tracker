# GitHub to iPhone automatic updates

The app project and Xcode Cloud preparation script are included in this repository. Xcode Cloud/TestFlight distribution still needs your Apple Developer Program account connection. Local installation through Xcode can use your Personal Team.

## One-time setup in your account

1. Join the Apple Developer Program if you aren't already a member. Sign in with that account in Xcode and select its Team under the App target's Signing & Capabilities.
2. Use this Watched-Tracker GitHub repository as the source for the workflow.
3. Open `ios/App/App.xcodeproj`. Under **Product → Xcode Cloud → Create Workflow**, select the App product and your team. Connect the GitHub repository when Apple's authorization screen appears.
4. Set the workflow to start for **branch changes to main**. Use an Xcode 26+ environment, add an **Archive** action for iOS and configure **TestFlight internal testing** as its post-action. Create or select the matching App Store Connect record and an internal tester group.
5. Add your Apple Account as an internal tester. Start the first build and resolve any signing or App Store Connect setup prompts.
6. Install Apple's TestFlight on your iPhone, accept the invitation, install Watched Tracker, then enable **Automatic Updates** on its TestFlight page.

The shared App scheme and `ios/App/ci_scripts/ci_post_clone.sh` are supplied. The script installs Node.js 24 dependencies, runs the unit checks, rebuilds the bundled screens from that commit and prepares a unique archive build number. It must finish successfully before the archive can ship. Apple's cloud service handles signing after you connect the team.

## After setup

When you ask for a change and a GitHub push, I can update the source and push the authorized change. A push to `main` starts Xcode Cloud. After a successful archive and Apple's processing, the available beta can install through TestFlight's automatic updates. This isn't instant, and Apple controls delivery timing. Failed builds leave the previously installed version in place.

TestFlight builds expire after 90 days. Public App Store releases use App Store review and release settings; users receive approved releases through App Store updates. External beta testers may require beta review. Internal testing is the simplest initial workflow for you.

Keep Apple signing credentials and private service credentials out of GitHub source files. The repository uses the existing custom PIN backend; no database changes or APNs credentials are needed for its local iPhone reminders.

Official setup: [Xcode Cloud workflows](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow/), [TestFlight distribution](https://developer.apple.com/documentation/xcode/distributing-your-xcode-cloud-builds-through-testflight), [TestFlight automatic updates](https://testflight.apple.com/).
