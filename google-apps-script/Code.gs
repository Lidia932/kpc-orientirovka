const ARCHIVE_FOLDER_ID = '10UIpRNpDoHZEb27ZD-AkhS0OQHgswBvN';
const FIREBASE_PROJECT_ID = 'kpc-simbirsk';
const FIREBASE_API_KEY = 'AIzaSyDVNnz42UmNSFjyJK4AzsneHEw4ljt53gA';
const OWNER_EMAIL = 'lidiya.lynx@gmail.com';
const SITE_ORIGIN = 'https://lidia932.github.io';
const MAX_PDF_BYTES = 35 * 1024 * 1024;
const MAX_TRACK_BYTES = 15 * 1024 * 1024;
const TRACKS_FOLDER_NAME = 'Треки активных поисков';

function doGet() {
  return HtmlService.createHtmlOutput('KPC archive uploader is ready.');
}

function doPost(event) {
  const parameters = event && event.parameter ? event.parameter : {};
  const nonce = cleanText_(parameters.nonce, 120);
  const action = cleanText_(parameters.action, 40);
  const responseTypes = {
    deleteAuthUser: 'kpc-user-delete',
    deleteArchive: 'kpc-archive-delete',
    uploadTrack: 'kpc-track-upload',
    deleteTrack: 'kpc-track-delete'
  };
  const responseType = responseTypes[action] || 'kpc-drive-archive';

  try {
    const idToken = cleanText_(parameters.idToken, 10000);
    const user = verifyFirebaseUser_(idToken);
    const profile = getFirebaseProfile_(idToken, user.localId);

    if (action === 'uploadTrack') {
      if (!profile || profile.approved !== true) {
        throw new Error('Доступ к загрузке треков не подтвержден.');
      }
      const track = saveTrack_(parameters, idToken, user, profile);
      return responsePage_({type: responseType, nonce: nonce, ok: true, track: track});
    }

    if (action === 'deleteTrack') {
      if (!profile || profile.approved !== true) {
        throw new Error('Доступ к удалению треков не подтвержден.');
      }
      deleteTrack_(cleanId_(parameters.trackId), idToken, user.localId, profile.role === 'admin');
      return responsePage_({type: responseType, nonce: nonce, ok: true});
    }

    if (!profile || profile.approved !== true || profile.role !== 'admin') {
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

    if (action === 'deleteArchive') {
      if (String(user.email || '').toLowerCase() !== OWNER_EMAIL) {
        throw new Error('Удалять архивные записи может только владелец.');
      }
      deleteArchive_(cleanId_(parameters.caseId));
      return responsePage_({type: responseType, nonce: nonce, ok: true});
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
    role: fields.role ? fields.role.stringValue : '',
    displayName: fields.displayName ? fields.displayName.stringValue : '',
    email: fields.email ? fields.email.stringValue : ''
  };
}

function saveTrack_(parameters, idToken, user, profile) {
  const caseId = cleanId_(parameters.caseId);
  const trackId = cleanId_(parameters.trackId);
  const fileName = cleanTrackFileName_(parameters.fileName);
  const mimeType = cleanTrackMimeType_(parameters.fileType);
  const bytes = decodeTrack_(parameters.fileBase64);
  const caseDocument = getFirestoreDocument_(idToken, 'cases', caseId);
  const caseStatus = firestoreString_(caseDocument, 'status');

  if (!caseDocument || caseStatus !== 'active') {
    throw new Error('Треки можно добавлять только в активный поиск.');
  }

  const folder = getTrackCaseFolder_(caseId);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  const track = {
    id: trackId,
    caseId: caseId,
    fileName: fileName,
    fileSize: bytes.length,
    mimeType: mimeType,
    driveFileId: file.getId(),
    url: file.getUrl(),
    authorId: user.localId,
    authorName: cleanText_(profile.displayName || user.displayName || user.email || 'Пользователь', 120),
    authorEmail: user.email || profile.email || '',
    createdAt: new Date().toISOString()
  };

  try {
    createTrackDocument_(idToken, track);
  } catch (error) {
    try {
      file.setTrashed(true);
    } catch (cleanupError) {
      console.error('Track cleanup failed: ' + cleanupError);
    }
    throw error;
  }
  return track;
}

function deleteTrack_(trackId, idToken, userId, isAdmin) {
  const document = getFirestoreDocument_(idToken, 'tracks', trackId);
  if (!document) return;
  const authorId = firestoreString_(document, 'authorId');
  if (!isAdmin && authorId !== userId) {
    throw new Error('Удалять можно только собственные треки.');
  }

  const driveFileId = firestoreString_(document, 'driveFileId');
  if (driveFileId) {
    try {
      DriveApp.getFileById(driveFileId).setTrashed(true);
    } catch (error) {
      console.error('Track file delete failed: ' + error);
    }
  }

  const response = UrlFetchApp.fetch(firestoreDocumentUrl_('tracks', trackId), {
    method: 'delete',
    headers: {Authorization: 'Bearer ' + idToken},
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200 && response.getResponseCode() !== 404) {
    console.error('Track metadata delete failed: ' + response.getResponseCode() + ' ' + response.getContentText());
    throw new Error('Не удалось удалить карточку трека.');
  }
}

function getTrackCaseFolder_(caseId) {
  const properties = PropertiesService.getScriptProperties();
  const propertyKey = 'track_folder_' + caseId;
  const savedFolderId = properties.getProperty(propertyKey);
  if (savedFolderId) {
    try {
      return DriveApp.getFolderById(savedFolderId);
    } catch (error) {
      properties.deleteProperty(propertyKey);
    }
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Загрузчик треков занят. Повторите через несколько секунд.');
  try {
    const concurrentFolderId = properties.getProperty(propertyKey);
    if (concurrentFolderId) return DriveApp.getFolderById(concurrentFolderId);
    const archiveFolder = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
    const tracksFolders = archiveFolder.getFoldersByName(TRACKS_FOLDER_NAME);
    const tracksFolder = tracksFolders.hasNext() ? tracksFolders.next() : archiveFolder.createFolder(TRACKS_FOLDER_NAME);
    const caseFolder = tracksFolder.createFolder(caseId);
    properties.setProperty(propertyKey, caseFolder.getId());
    return caseFolder;
  } finally {
    lock.releaseLock();
  }
}

function createTrackDocument_(idToken, track) {
  const fields = {
    caseId: {stringValue: track.caseId},
    fileName: {stringValue: track.fileName},
    fileSize: {integerValue: String(track.fileSize)},
    mimeType: {stringValue: track.mimeType},
    driveFileId: {stringValue: track.driveFileId},
    url: {stringValue: track.url},
    authorId: {stringValue: track.authorId},
    authorName: {stringValue: track.authorName},
    authorEmail: {stringValue: track.authorEmail},
    createdAt: {timestampValue: track.createdAt}
  };
  const response = UrlFetchApp.fetch(firestoreDocumentUrl_('tracks', track.id), {
    method: 'patch',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + idToken},
    payload: JSON.stringify({fields: fields}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    console.error('Track metadata save failed: ' + response.getResponseCode() + ' ' + response.getContentText());
    throw new Error('Не удалось сохранить карточку трека.');
  }
}

function getFirestoreDocument_(idToken, collectionName, documentId) {
  const response = UrlFetchApp.fetch(firestoreDocumentUrl_(collectionName, documentId), {
    method: 'get',
    headers: {Authorization: 'Bearer ' + idToken},
    muteHttpExceptions: true
  });
  if (response.getResponseCode() === 404) return null;
  if (response.getResponseCode() !== 200) {
    throw new Error('Не удалось проверить данные активного поиска.');
  }
  return JSON.parse(response.getContentText());
}

function firestoreDocumentUrl_(collectionName, documentId) {
  return 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID
    + '/databases/(default)/documents/' + encodeURIComponent(collectionName)
    + '/' + encodeURIComponent(documentId);
}

function firestoreString_(document, fieldName) {
  const field = document && document.fields ? document.fields[fieldName] : null;
  return field && field.stringValue ? String(field.stringValue) : '';
}

function deleteFirebaseAuthUser_(userId) {
  const response = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete', {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + getFirebaseAdminAccessToken_()},
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

function getFirebaseAdminAccessToken_() {
  const cache = CacheService.getScriptCache();
  const cachedToken = cache.get('firebase_admin_access_token_v2');
  if (cachedToken) return cachedToken;

  const credentialsJson = PropertiesService.getScriptProperties()
    .getProperty('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!credentialsJson) {
    throw new Error('Не настроена служебная учетная запись Firebase.');
  }

  const credentials = parseJson_(credentialsJson);
  if (!credentials || !credentials.client_email || !credentials.private_key) {
    throw new Error('Неверные данные служебной учетной записи Firebase.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson_({alg: 'RS256', typ: 'JWT'});
  const claims = base64UrlJson_({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const unsignedToken = header + '.' + claims;
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(unsignedToken, credentials.private_key)
  ).replace(/=+$/, '');

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsignedToken + '.' + signature
    },
    muteHttpExceptions: true
  });

  const payload = parseJson_(response.getContentText()) || {};
  if (response.getResponseCode() !== 200 || !payload.access_token) {
    console.error('Firebase service account authorization failed: '
      + response.getResponseCode() + ' ' + response.getContentText());
    throw new Error('Не удалось авторизовать служебную учетную запись Firebase.');
  }

  cache.put('firebase_admin_access_token_v2', payload.access_token, 3300);
  return payload.access_token;
}

function deleteArchive_(caseId) {
  const accessToken = getFirebaseAdminAccessToken_();
  const url = firestoreDocumentUrl_('cases', caseId);
  const readResponse = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + accessToken},
    muteHttpExceptions: true
  });

  if (readResponse.getResponseCode() === 404) return;
  if (readResponse.getResponseCode() !== 200) {
    console.error('Archive read failed: ' + readResponse.getResponseCode() + ' ' + readResponse.getContentText());
    throw new Error('Не удалось проверить архивную запись.');
  }

  const document = JSON.parse(readResponse.getContentText());
  if (firestoreString_(document, 'status') !== 'archive') {
    throw new Error('Удалять этой кнопкой можно только архивные записи.');
  }

  const driveFileId = firestoreString_(document, 'driveFileId');
  let driveFile = null;
  if (driveFileId) {
    try {
      driveFile = DriveApp.getFileById(driveFileId);
      driveFile.setTrashed(true);
    } catch (error) {
      console.error('Archive PDF delete failed: ' + error);
      throw new Error('Не удалось удалить PDF с Google Drive.');
    }
  }

  const deleteResponse = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {Authorization: 'Bearer ' + accessToken},
    muteHttpExceptions: true
  });
  if (deleteResponse.getResponseCode() !== 200) {
    if (driveFile) {
      try { driveFile.setTrashed(false); } catch (restoreError) { console.error(restoreError); }
    }
    console.error('Archive metadata delete failed: ' + deleteResponse.getResponseCode() + ' ' + deleteResponse.getContentText());
    throw new Error('Не удалось удалить архивную запись из базы.');
  }

  PropertiesService.getScriptProperties().deleteProperty('archive_' + caseId);
}

function base64UrlJson_(value) {
  return Utilities.base64EncodeWebSafe(
    JSON.stringify(value),
    Utilities.Charset.UTF_8
  ).replace(/=+$/, '');
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

function decodeTrack_(base64) {
  const value = String(base64 || '').trim();
  if (!value) throw new Error('Файл трека не передан.');
  let bytes;
  try {
    bytes = Utilities.base64Decode(value);
  } catch (error) {
    throw new Error('Не удалось прочитать файл трека.');
  }
  if (!bytes.length || bytes.length > MAX_TRACK_BYTES) {
    throw new Error('Размер трека должен быть не больше 15 МБ.');
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

function cleanTrackFileName_(value) {
  const result = String(value || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!result || result.length > 200 || !/\.(gpx(?:\.bin)?|kml|kmz|tcx|fit)$/i.test(result)) {
    throw new Error('Допустимы только файлы GPX, GPX.BIN, KML, KMZ, TCX и FIT.');
  }
  return result;
}

function cleanTrackMimeType_(value) {
  const result = cleanText_(value, 120).trim().toLowerCase();
  if (!result || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(result)) {
    return 'application/octet-stream';
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
    'Удалять архивные записи может только владелец.',
    'Удалять этой кнопкой можно только архивные записи.',
    'Не удалось проверить архивную запись.',
    'Не удалось удалить PDF с Google Drive.',
    'Не удалось удалить архивную запись из базы.',
    'Нельзя удалить собственную учетную запись.',
    'Удалять можно только заявки со статусом «Ожидает».',
    'Не удалось проверить права пользователя.',
    'Не удалось удалить учетную запись из Firebase Authentication.',
    'Не настроена служебная учетная запись Firebase.',
    'Неверные данные служебной учетной записи Firebase.',
    'Не удалось авторизовать служебную учетную запись Firebase.',
    'Доступ к загрузке треков не подтвержден.',
    'Доступ к удалению треков не подтвержден.',
    'Треки можно добавлять только в активный поиск.',
    'Удалять можно только собственные треки.',
    'Не удалось удалить карточку трека.',
    'Не удалось сохранить карточку трека.',
    'Не удалось проверить данные активного поиска.',
    'Файл трека не передан.',
    'Не удалось прочитать файл трека.',
    'Размер трека должен быть не больше 15 МБ.',
    'Допустимы только файлы GPX, GPX.BIN, KML, KMZ, TCX и FIT.',
    'Загрузчик треков занят. Повторите через несколько секунд.',
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
      : action === 'deleteArchive'
        ? 'Не удалось удалить архивную запись.'
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
