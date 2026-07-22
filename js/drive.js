/*
 * PseudoStudio - Google Drive loader (OAuth via Google Identity Services).
 * Reads a folder containing:
 *   setup.ini          -> instruction=<file>  files=<f1>,<f2>,...
 *   <instruction file> -> markdown shown in the left panel
 *   <code files>       -> opened as Pseudo files
 */
(function () {
  const NS = (window.PseudoStudio = window.PseudoStudio || {});
  const DRIVE = "https://www.googleapis.com/drive/v3";
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

  function loadGSI() {
    return new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Could not load Google Identity script.")); };
      document.head.appendChild(s);
    });
  }

  function getAccessToken(clientId) {
    return loadGSI().then(function () {
      return new Promise(function (resolve, reject) {
        try {
          const client = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPE,
            callback: function (resp) {
              if (resp && resp.access_token) resolve(resp.access_token);
              else reject(new Error("Google did not return an access token."));
            },
          });
          client.requestAccessToken({ prompt: "consent" });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async function listFolder(token, folderId) {
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed = false");
    const url = DRIVE + "/files?q=" + q + "&fields=files(id,name,mimeType)&pageSize=1000";
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("Drive list failed (HTTP " + r.status + ").");
    const data = await r.json();
    return data.files || [];
  }

  async function downloadText(token, fileId) {
    const url = DRIVE + "/files/" + fileId + "?alt=media";
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("Drive download failed (HTTP " + r.status + ").");
    return await r.text();
  }

  function findByName(files, name) {
    const lower = name.toLowerCase();
    return files.find(function (f) { return f.name.toLowerCase() === lower; }) || null;
  }

  // setup.ini parser:  instruction = instruction.md \n files = a.pseudo, b.pseudo
  function parseSetup(text) {
    const out = { instruction: null, files: [] };
    (text || "").split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (!line || line[0] === "#" || line[0] === ";" || line[0] === "[") return;
      const m = /^([^=]+)=(.*)$/.exec(line);
      if (!m) return;
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === "instruction") out.instruction = val;
      else if (key === "files") out.files = val.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    });
    return out;
  }

  function folderIdFromInput(s) {
    s = (s || "").trim();
    const m = /\/folders\/([a-zA-Z0-9_-]+)/.exec(s);
    if (m) return m[1];
    const m2 = /[?&]id=([a-zA-Z0-9_-]+)/.exec(s);
    if (m2) return m2[1];
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return null;
  }

  async function loadFromDrive(clientId, folderId) {
    if (!clientId) throw new Error("Missing GOOGLE_CLIENT_ID (set it in config.js).");
    if (!folderId) throw new Error("Missing folder ID.");
    const token = await getAccessToken(clientId);
    const files = await listFolder(token, folderId);

    const setup = findByName(files, "setup.ini");
    if (!setup) throw new Error("setup.ini was not found in this folder.");
    const cfg = parseSetup(await downloadText(token, setup.id));
    if (!cfg.instruction) throw new Error("setup.ini is missing 'instruction = <file>'.");
    if (!cfg.files.length) throw new Error("setup.ini is missing 'files = <f1>, <f2>, ...'.");

    const instrFile = findByName(files, cfg.instruction);
    if (!instrFile) throw new Error("Instruction file not found in folder: " + cfg.instruction);
    const instruction = await downloadText(token, instrFile.id);

    const codeFiles = [];
    for (const name of cfg.files) {
      const f = findByName(files, name);
      if (!f) throw new Error("File not found in folder: " + name);
      codeFiles.push({ name: name, content: await downloadText(token, f.id) });
    }
    return { instruction: instruction, files: codeFiles, folderId: folderId };
  }

  NS.drive = {
    loadFromDrive: loadFromDrive,
    folderIdFromInput: folderIdFromInput,
  };
})();
