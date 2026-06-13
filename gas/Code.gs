/**
 * 就活マイページ マネージャー — Google Apps Script Web アプリ
 *
 * 拡張機能から POST された JSON を受け取り、スプレッドシートに upsert する。
 * id 列をキーに、既存行があれば更新、なければ追記する。
 *
 * デプロイ手順は README.md を参照。
 */

const SHEET_NAME = 'マイページ管理';
const HEADERS = ['id', '企業名', '業界', 'マイページURL', 'ログインID', 'パスワード', '締切', 'ステータス', 'メモ', '更新日時'];

function doGet() {
  return json_({ ok: true, message: '就活マイページ マネージャー GAS は稼働中です' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    const sheet = getSheet_();

    if (body.action === 'sync' && Array.isArray(body.entries)) {
      body.entries.forEach(function (entry) {
        upsert_(sheet, entry);
      });
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  // ヘッダ行が無ければ作る
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
    entry.status || '',
    entry.memo || '',
    entry.updatedAt || '',
  ];
}

function upsert_(sheet, entry) {
  const lastRow = sheet.getLastRow();
  let rowIndex = -1;
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === entry.id) {
        rowIndex = i + 2;
        break;
      }
    }
  }

  // 削除フラグ付きは行を削除
  if (entry.deleted) {
    if (rowIndex > 0) sheet.deleteRow(rowIndex);
    return;
  }

  const row = rowFromEntry_(entry);
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
