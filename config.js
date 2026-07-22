/*
 * PseudoStudio - runtime configuration.
 *
 * To enable "Load from Drive":
 *   1. Create an OAuth 2.0 Web Client ID in Google Cloud Console
 *      (APIs & Services -> Credentials -> OAuth client ID -> Web application).
 *   2. Add authorized JavaScript origins, e.g.
 *        http://localhost:5190
 *        https://juanlouisr.github.io
 *   3. Enable the Google Drive API for the project.
 *   4. On the OAuth consent screen, add the scope
 *        https://www.googleapis.com/auth/drive.readonly
 *      (keep the app in "Testing" and add candidate emails as test users,
 *       or submit for verification for public use.)
 *   5. Paste the Client ID below and optionally a default folder URL.
 */
window.PS_CONFIG = {
  GOOGLE_CLIENT_ID: "192162313353-30n5f00663p0491h8vekf6gjuoai0iss.apps.googleusercontent.com",                 // e.g. "xxxx.apps.googleusercontent.com"
  DEFAULT_FOLDER_URL: "",               // optional pre-fill for the folder prompt
};
