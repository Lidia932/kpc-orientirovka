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
  const action = cleanText_(parameters.action, 40);
  const responseType = action === 'deleteAuthUser' ? 'kpc-user-delete' : 'kpc-drive-archive';

  try {
    const idToken = cleanText_(parameters.idToken, 10000);
    const user = verifyFirebaseUser_(idToken);

    if (!isArchiveAdmin_(idToken, user.localId)) {
      throw new Error('Действие доступно только администраторам.');
    }

    if (action === 'deleteAuthUser') {
      const targetUserId = cleanUserId_(parameters.targetUserId);
      if (targetUserId === user.localId) throw new Error('Нельзя удалить собственную учетную запись.');

      const targetProfile = getFirebaseProfile_(idToken, targetUserId);
      if (!targetProfile || targetProfile.approved !== false || targetProfile.role !== 'member') {
        throw new Error('Удалять можно только заявки со статусом «Ожидает».');
      }

      deleteFirebaseAuthUser_(targetUserId);
      return responsePage_({
        type: responseType,
        nonce: nonce,
        ok: true
      });
    }

    const caseId = cleanId_(parameters.caseId);
    const fileName = cleanFileName_(parameters.fileName);
    const pdfBytes = decodePdf_(parameters.pdfBase64);
    const file = saveArchiveFile_(caseId, fileName, pdfBytes);
    return responsePage_({
      type: responseType,
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
      type: responseType,
      nonce: nonce,
      ok: false,
      error: userError_(error, action)
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
  const profile = getFirebaseProfile_(idToken, userId);
  return profile && profile.approved === true && profile.role === 'admin';
}

function getFirebaseProfile_(idToken, userId) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
    + '/databases/(default)/documents/users/' + encodeURIComponent(userId);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + idToken},
    muteHttpExceptions: true
  });

  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() !== 200) throw new Error('Не удалось проверить права пользователя.');
  const document = JSON.parse(response.getContentText());
  const fields = document.fields || {};
  return {
    approved: fields.approved ? fields.approved.booleanValue === true : null,
    role: fields.role ? fields.role.stringValue : ''
  };
}

function deleteFirebaseAuthUser_(userId) {
  const response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete', {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    payload: JSON.stringify({
      localId: userId,
      targetProjectId: FIREBASE_PROJECT_ID
    }),
    muteHttpExceptions: true
  });

  if (response.getResponseCode() === 200) return;
  const payload = parseJson_(response.getContentText()) || {};
  const apiMessage = payload.error && payload.error.message ? String(payload.error.message) : '';
  if (apiMessage.indexOf('USER_NOT_FOUND') >= 0) return;
  console.error('Firebase Authentication delete failed: ' + response.getResponseCode() + ' ' + response.getContentText());
  throw new Error('Не удалось удалить учетную запись из Firebase Authentication.');
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

function cleanUserId_(value) {
  const result = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(result)) throw new Error('Неверный идентификатор пользователя.');
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

function userError_(error, action) {
  const message = error && error.message ? String(error.message) : '';
  const allowed = [
    'Не передан токен пользователя.',
    'Авторизация пользователя истекла. Войдите на сайт заново.',
    'Пользователь не найден.',
    'Действие доступно только администраторам.',
    'Нельзя удалить собственную учетную запись.',
    'Удалять можно только заявки со статусом «Ожидает».',
    'Не удалось проверить права пользователя.',
    'Не удалось удалить учетную запись из Firebase Authentication.',
    'Неверный идентификатор пользователя.',
    'Загрузчик занят. Повторите через несколько секунд.',
    'PDF-файл не передан.',
    'Не удалось прочитать PDF-файл.',
    'Размер PDF должен быть не больше 35 МБ.',
    'Переданный файл не является PDF.',
    'Неверный идентификатор ориентировки.',
    'Неверное имя PDF-файла.'
  ];
  return allowed.indexOf(message) >= 0
    ? message
    : action === 'deleteAuthUser'
      ? 'Не удалось удалить учетную запись пользователя.'
      : 'Не удалось сохранить PDF на Google Drive.';
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
