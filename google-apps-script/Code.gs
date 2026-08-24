const ARCHIVE_FOLDER_ID = '10UIpRNpDoHZEb27ZD-AkhS0OQHgswBvN';
const FIREBASE_PROJECT_ID = 'kpc-simbirsk';
const FIREBASE_API_KEY = 'AIzaSyDVNnz42UmNSFjyJK4AzsneHEw4ljt53gA';
const SITE_ORIGIN = 'https://lidia932.github.io';
const MAX_PDF_BYTES = 35 * 1024 * 1024;

function doGet() {
  return HtmlService.createHtmlOutput('KPC archive uploader is ready.');
}

function doPost(event) {
  const parameters = event && event.parameter ? event.parameter : {};
  const nonce = cleanText_(parameters.nonce, 120);

  try {
    const idToken = cleanText_(parameters.idToken, 10000);
    const caseId = cleanId_(parameters.caseId);
    const fileName = cleanFileName_(parameters.fileName);
    const pdfBytes = decodePdf_(parameters.pdfBase64);
    const user = verifyFirebaseUser_(idToken);

    if (!isArchiveAdmin_(idToken, user.localId)) {
      throw new Error('Архивировать ориентировки могут только администраторы.');
    }

    const file = saveArchiveFile_(caseId, fileName, pdfBytes);
    return responsePage_({
      type: 'kpc-drive-archive',
      nonce: nonce,
      ok: true,
      file: {
        id: file.getId(),
        name: file.getName(),
        webViewLink: file.getUrl()
      }
    });
  } catch (error) {
    console.error(error);
    return responsePage_({
      type: 'kpc-drive-archive',
      nonce: nonce,
      ok: false,
      error: userError_(error)
    });
  }
}

function verifyFirebaseUser_(idToken) {
  if (!idToken) throw new Error('Не передан токен пользователя.');

  const response = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(FIREBASE_API_KEY),
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({idToken: idToken}),
      muteHttpExceptions: true
    }
  );

  if (response.getResponseCode() !== 200) {
    throw new Error('Авторизация пользователя истекла. Войдите на сайт заново.');
  }

  const payload = JSON.parse(response.getContentText());
  const user = payload.users && payload.users[0];
  if (!user || !user.localId) throw new Error('Пользователь не найден.');
  return user;
}

function isArchiveAdmin_(idToken, userId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
    + '/databases/(default)/documents/users/' + encodeURIComponent(userId);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + idToken},
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) return false;
  const document = JSON.parse(response.getContentText());
  return document.fields
    && document.fields.approved
    && document.fields.approved.booleanValue === true
    && document.fields.role
    && document.fields.role.stringValue === 'admin';
}

function saveArchiveFile_(caseId, fileName, pdfBytes) {
  const digest = digest_(pdfBytes);
  const propertyKey = 'archive_' + caseId;
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) throw new Error('Загрузчик занят. Повторите через несколько секунд.');

  try {
    const properties = PropertiesService.getScriptProperties();
    const previous = parseJson_(properties.getProperty(propertyKey));

    if (previous && previous.digest === digest && previous.fileId) {
      try {
        return DriveApp.getFileById(previous.fileId);
      } catch (error) {
        properties.deleteProperty(propertyKey);
      }
    }

    const blob = Utilities.newBlob(pdfBytes, MimeType.PDF, fileName);
    const file = DriveApp.getFolderById(ARCHIVE_FOLDER_ID).createFile(blob);
    properties.setProperty(propertyKey, JSON.stringify({
      digest: digest,
      fileId: file.getId()
    }));
    return file;
  } finally {
    lock.releaseLock();
  }
}

function decodePdf_(base64) {
  const value = String(base64 || '').trim();
  if (!value) throw new Error('PDF-файл не передан.');

  let bytes;
  try {
    bytes = Utilities.base64Decode(value);
  } catch (error) {
    throw new Error('Не удалось прочитать PDF-файл.');
  }

  if (bytes.length < 5 || bytes.length > MAX_PDF_BYTES) {
    throw new Error('Размер PDF должен быть не больше 35 МБ.');
  }
  if (bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70 || bytes[4] !== 45) {
    throw new Error('Переданный файл не является PDF.');
  }
  return bytes;
}

function digest_(bytes) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
  );
}

function cleanId_(value) {
  const result = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(result)) throw new Error('Неверный идентификатор ориентировки.');
  return result;
}

function cleanFileName_(value) {
  const result = String(value || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!result || result.length > 200 || !/\.pdf$/i.test(result)) {
    throw new Error('Неверное имя PDF-файла.');
  }
  return result;
}

function cleanText_(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

function parseJson_(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch (error) {
    return null;
  }
}

function userError_(error) {
  const message = error && error.message ? String(error.message) : '';
  const allowed = [
    'Не передан токен пользователя.',
    'Авторизация пользователя истекла. Войдите на сайт заново.',
    'Пользователь не найден.',
    'Архивировать ориентировки могут только администраторы.',
    'Загрузчик занят. Повторите через несколько секунд.',
    'PDF-файл не передан.',
    'Не удалось прочитать PDF-файл.',
    'Размер PDF должен быть не больше 35 МБ.',
    'Переданный файл не является PDF.',
    'Неверный идентификатор ориентировки.',
    'Неверное имя PDF-файла.'
  ];
  return allowed.indexOf(message) >= 0 ? message : 'Не удалось сохранить PDF на Google Drive.';
}

function responsePage_(payload) {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
  const targetOrigin = JSON.stringify(SITE_ORIGIN);
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"></head><body>'
    + '<script>window.top.postMessage(' + serialized + ',' + targetOrigin + ');<\/script>'
    + '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
