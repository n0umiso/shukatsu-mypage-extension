/**
 * 就活マイページ マネージャー — Google Apps Script Web アプリ
 *
 * 拡張機能から POST された JSON を受け取り、スプレッドシートに upsert する。
 * PWA から GET でエントリ一覧を返す（パスワードは含まない）。
 * id 列をキーに、既存行があれば更新、なければ追記する。
 *
 * デプロイ手順は README.md を参照。
 */

const SHEET_NAME = 'マイページ管理';
const HEADERS = ['id', '企業名', '業界', 'マイページURL', 'ログインID', 'パスワード', '締切', '選考ステージ', 'メモ', '更新日時'];

function verifyToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  if (!expected) return true;
  return token === expected;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'list') {
    var token = (e && e.parameter && e.parameter.token) || '';
    if (!verifyToken_(token)) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    var sheet = getSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return json_({ ok: true, entries: [] });
    var data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    var entries = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      entries.push({
        companyName: row[1] || '',
        industry: row[2] || '',
        mypageUrl: row[3] || '',
        deadlines: row[6] || '',
        stage: row[7] || '',
        memo: row[8] || '',
        updatedAt: row[9] || '',
      });
    }
    return json_({ ok: true, entries: entries });
  }
  return json_({ ok: true, message: '就活マイページ マネージャー GAS は稼働中です' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    if (!verifyToken_(body.token || '')) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    var sheet = getSheet_();

    if (body.action === 'sync' && Array.isArray(body.entries)) {
      var deleteRows = [];
      for (var i = 0; i < body.entries.length; i++) {
        var entry = body.entries[i];
        if (entry.deleted) {
          var idx = findRow_(sheet, entry.id);
          if (idx > 0) deleteRows.push(idx);
        } else {
          upsert_(sheet, entry);
        }
      }
      deleteRows.sort(function(a, b) { return b - a; });
      for (var j = 0; j < deleteRows.length; j++) {
        sheet.deleteRow(deleteRows[j]);
      }
      return json_({ ok: true, count: body.entries.length });
    }
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rowFromEntry_(entry) {
  return [
    entry.id,
    entry.companyName || '',
    entry.industry || '',
    entry.mypageUrl || '',
    entry.loginId || '',
    entry.password || '',
    entry.deadlines || '',
    entry.stage || '',
    entry.memo || '',
    entry.updatedAt || '',
  ];
}

function findRow_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function upsert_(sheet, entry) {
  var rowIndex = findRow_(sheet, entry.id);
  var row = rowFromEntry_(entry);
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
