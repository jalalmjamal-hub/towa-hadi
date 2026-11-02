/** @NotOnlyCurrentDoc */
/*******************************
 * 1) إعدادات النظام
 *******************************/
const ADMIN_PASSWORD = "Awamia@123#";

/*******************************
 * 1.1) include
 *******************************/
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/*******************************
 * Routing — FINAL CLEAN VERSION
 *******************************/
function doGet(e) {
  const page = e?.parameter?.page;

  // الصفحات المتاحة فعليًا
  const pages = {
    tawkeel_settings: "tawkeel_settings",
    slaughter_actions: "slaughter_actions",
    slaughter_action: "slaughter_actions",
    login: "login"
  };

  // لو طلب صفحة غير موجودة → نرجع للصفحة الرئيسية index
  const file = pages[page] || "index";

  const t = HtmlService.createTemplateFromFile(file);

  return t.evaluate()
    .setTitle("نظام الهدي الإلكتروني")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

/*******************************
 * 3) التحقق من كلمة المرور
 *******************************/
function checkPassword(pass) {
  return pass === ADMIN_PASSWORD ? "OK" : "NO";
}

/*******************************
 * 4) البحث عن حاج
 *******************************/
function searchHaj(idOrMobile) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return { name: "لا توجد بيانات" };

  const data = db.getRange(2, 1, last - 1, 9).getValues();

  idOrMobile = String(idOrMobile).trim().replace(/\s+/g, "");

  const normalizePhone = p => {
    p = String(p).trim();
    if (p.startsWith("+966")) p = p.substring(4);
    if (p.startsWith("00966")) p = p.substring(5);
    if (p.startsWith("05")) p = p.substring(1);
    if (p.startsWith("0")) p = p.substring(1);
    return p;
  };

  const searchPhone = normalizePhone(idOrMobile);

  for (let r of data) {
    const id = String(r[0]).trim();
    const mobile = normalizePhone(r[1]);

    if (id === idOrMobile || mobile === searchPhone || mobile.endsWith(searchPhone)) {
      return {
        name: r[2],
        tawkeel: r[4] || "",
        rami: r[5] || "",
        thabh: r[6] || "",
        certUrl: r[7] || ""
      };
    }
  }

  return { name: "غير موجود" };
}

/*******************************
 * 5–6) تحديث التوكيل والرمي
 *******************************/
function updateTawkeelWeb(idOrMobile, value) {
  updateStatus(idOrMobile, value, 5);
}
function updateRamiWeb(idOrMobile, value) {
  updateStatus(idOrMobile, value, 6);
}

/*******************************
 * 7) تحديث الذبح — فوري (الخيار A)
 *******************************/
function updateSlaughterWeb(id) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");

  const cell = db.getRange("A:A").createTextFinder(id).findNext();
  if (!cell) return;

  const row = cell.getRow();

  db.getRange(row, 7).setValue("تم الذبح");  // حالة الذبح
}

/*******************************
 * 7.1) إلغاء الذبح
 *******************************/
function undoSlaughterWeb(id) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");

  const cell = db.getRange("A:A").createTextFinder(id).findNext();
  if (!cell) return;

  const row = cell.getRow();

  db.getRange(row, 7).setValue("لم يتم"); // حالة الذبح
  db.getRange(row, 8).setValue("");        // رابط الشهادة
}
/*******************************
 * 7.2) ذبح + شهادة فقط
 *******************************/
function slaughterAndGenerateCert(id) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return "";

  const data = db.getRange(2, 1, last - 1, 9).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {

      const name = data[i][2];
      const gender = data[i][3];

      const certUrl = createSlaughterCertificate(id, name, gender);

      db.getRange(i + 2, 8).setValue(certUrl);

      return certUrl;
    }
  }
  return "";
}
function slaughterAndCert(id){
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return "";

  const range = db.getRange(2, 1, last - 1, 9);
  const data = range.getValues();

  let certUrl = "";

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {

      const name = data[i][2];
      const gender = data[i][3];

      // توليد الشهادة
      certUrl = createSlaughterCertificate(id, name, gender);

      // تعديل داخل الذاكرة
      data[i][6] = "تم الذبح";
      data[i][7] = certUrl;

      break;
    }
  }

  range.setValues(data); // كتابة واحدة فقط

  return certUrl;
}
/*******************************
 واتساب +توليد الشهادة
 *******************************/
function getOrCreateCert(id) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return "";

  const range = db.getRange(2, 1, last - 1, 9);
  const data = range.getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {

      // لو عنده شهادة جاهزة → نرجعها
      if (data[i][7]) {
        return data[i][7];
      }

      // لو ما عنده شهادة → نولّد واحدة
      const name = data[i][2];
      const gender = data[i][3];

      const certUrl = createSlaughterCertificate(id, name, gender);

      data[i][7] = certUrl; // حفظ الرابط

      range.setValues(data); // تحديث الشيت

      return certUrl;
    }
  }

  return "";
}


/*******************************
 * 8) دالة مشتركة للتحديث — بدون return نصي
 *******************************/
function updateStatus(idOrMobile, value, col) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return;

  const data = db.getRange(2, 1, last - 1, 9).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === idOrMobile || String(data[i][1]).trim() === idOrMobile) {
      db.getRange(i + 2, col).setValue(value);
      return;
    }
  }
}

/*******************************
 * 9–11) الإحصائيات
 *******************************/
function getDashboardStats() {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return { total: 0 };

  const data = db.getRange(2, 1, last - 1, 9).getValues();

  let total = data.length;
  let tawkeel = 0, rami = 0, thabh = 0;

  data.forEach(r => {
    if (r[4] === "تم التوكيل") tawkeel++;
    if (r[5] === "تم الرمي") rami++;
    if (r[6] === "تم الذبح") thabh++;
  });

  return {
    total,
    tawkeel,
    rami,
    thabh,
    notThabh: total - thabh,
    progress: total ? Math.round((thabh / total) * 100) : 0
  };
}

/*******************************
 * 12) مجلد الشهادات
 *******************************/
function getCertificatesFolder() {
  const name = "شهادات الهدي";
  const f = DriveApp.getFoldersByName(name);
  return f.hasNext() ? f.next() : DriveApp.createFolder(name);
}

/*******************************
 * 13) إنشاء شهادة PDF
 *******************************/
function createSlaughterCertificate(id, name, gender) {
  const TEMPLATE_ID = "1-y3aqOE7IglNYUr6Avfy_jXj7iZjHezFIA9R5Q2o37Q";

  const folder = getCertificatesFolder();
  const date = Utilities.formatDate(new Date(), "Asia/Riyadh", "yyyy-MM-dd HH:mm");

  const copy = DriveApp.getFileById(TEMPLATE_ID).makeCopy("شهادة_" + name + "_" + id);
  const doc = DocumentApp.openById(copy.getId());
  const body = doc.getBody();

  body.replaceText("{{NAME}}", name);
  body.replaceText("{{ID}}", id);
  body.replaceText("{{GENDER}}", gender);
  body.replaceText("{{DATE}}", date);

  doc.saveAndClose();

  const pdf = DriveApp.getFileById(copy.getId()).getAs("application/pdf");
  pdf.setName("شهادة_" + name + "_" + id + ".pdf");

  const file = folder.createFile(pdf);

  DriveApp.getFileById(copy.getId()).setTrashed(true);

  return file.getUrl();
}

/*******************************
 * 14) صفحة الإجراءات — حاج واحد
 *******************************/
function getSlaughterInfo(id) {
  const ss = SpreadsheetApp.getActive();
  const db = ss.getSheetByName("قاعدة_البيانات");

  const lastRow = db.getLastRow();
  if (lastRow < 2) return null;

  const data = db.getRange(2, 1, lastRow - 1, 8).getValues();

  for (let r of data) {
    if (String(r[0]).trim() === id) {
      return {
        id: r[0],
        mobile: r[1],
        name: r[2],
        gender: r[3],
        certUrl: r[7] || ""
      };
    }
  }

  return null;
}
function getCertUrl(id){
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = db.getLastRow();
  if (last < 2) return "";

  const data = db.getRange(2, 1, last - 1, 9).getValues();

  for (let r of data) {
    if (String(r[0]).trim() === id) {
      return r[7] || "";
    }
  }
  return "";
}
/*******************************
 * 15) حفظ نص التوكيل
 *******************************/
function saveTawkeelText(text) {
  const sheet = SpreadsheetApp.getActive().getSheetByName("الإعدادات");
  sheet.getRange("B2").setValue(text);
  return "تم حفظ نص التوكيل بنجاح";
}

/*******************************
 * 16) جلب نص التوكيل
 *******************************/
function getTawkeelText() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("الإعدادات");
  return sheet.getRange("B2").getValue();
}

/*******************************
 * 17) تصدير Excel — النسخة المعدلة
 *******************************/
function exportPilgrimsExcelFiltered(renderedRows) {

  // لو ما وصلت بيانات من الواجهة نوقف
  if (!renderedRows || renderedRows.length === 0) {
    return null;
  }

  // إنشاء ملف جديد
  const newSS = SpreadsheetApp.create("قائمة الحجاج — Excel");
  const sheet = newSS.getActiveSheet();

  // العنوان
  sheet.getRange("A1:H1").merge();
  sheet.getRange("A1").setValue("قائمة الحجاج — شركة طوى الشرق")
    .setFontSize(18)
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  // رأس الجدول
  const header = ["#", "الاسم", "الهوية", "الجوال", "الجنس", "التوكيل", "الرمي", "الذبح"];
  sheet.getRange(2, 1, 1, header.length).setValues([header])
    .setFontWeight("bold")
    .setBackground("#bcd4ff")
    .setHorizontalAlignment("center");

  // تجهيز البيانات
  const formatted = renderedRows.map((r, i) => [
    i + 1,
    r[2], // الاسم
    r[0], // الهوية
    r[1], // الجوال
    r[3], // الجنس
    r[4] && r[4].includes("تم") ? "☑" : "☐",
    r[5] && r[5].includes("تم") ? "☑" : "☐",
    r[6] && r[6].includes("ذبح") ? "☑" : "☐"
  ]);

  // إدخال البيانات
  sheet.getRange(3, 1, formatted.length, 8).setValues(formatted)
    .setHorizontalAlignment("center");

  // حدود
  sheet.getRange(2, 1, formatted.length + 1, 8)
    .setBorder(true, true, true, true, true, true);

  // ألوان صفوف متناوبة
  for (let i = 0; i < formatted.length; i++) {
    const rowNumber = i + 3;
    const color = (i % 2 === 0) ? "#ffffff" : "#f7f7f7";
    sheet.getRange(rowNumber, 1, 1, 8).setBackground(color);
  }

  // تجميد الصفوف
  sheet.setFrozenRows(2);

  // عرض الأعمدة
  const widths = [40, 180, 120, 120, 80, 120, 120, 120];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // تحويل إلى Excel
  const file = DriveApp.getFileById(newSS.getId())
    .getAs("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setName("قائمة_الحجاج.xlsx");

  const saved = DriveApp.createFile(file);

  return saved.getUrl();
}

/*******************************
 * 18) تصدير PDF
 *******************************/
function exportPilgrimsPDF() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("قاعدة_البيانات");

  const last = sh.getLastRow();
  if (last < 2) return null;

  const data = sh.getRange(2, 1, last - 1, 9).getValues();

  let html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      body { direction: rtl; font-family: Arial; font-size: 15px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #555; padding: 8px; text-align: center; }
      th { background: #bcd4ff; font-weight: bold; }
      tr:nth-child(even) { background: #f2f2f2; }
    </style>
  </head>
  <body>
    <h2 style="text-align:center;">قائمة الحجاج</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>الاسم</th>
          <th>الهوية</th>
          <th>الجوال</th>
          <th>الجنس</th>
          <th>التوكيل</th>
          <th>الرمي</th>
          <th>الذبح</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach((r, i) => {
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${r[2]}</td>
        <td>${r[0]}</td>
        <td>${r[1]}</td>
        <td>${r[3]}</td>
        <td>${r[4]}</td>
        <td>${r[5]}</td>
        <td>${r[6]}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  </body>
  </html>
  `;

  const blob = Utilities.newBlob(html, "text/html", "report.html")
    .getAs("application/pdf")
    .setName("قائمة_الحجاج.pdf");

  const saved = DriveApp.getRootFolder().createFile(blob);
  return saved.getUrl();
}

/*******************************
 * رفع الملفات — حذف جميع الحجاج
 *******************************/
function deleteAllPilgrims() {
  const sh = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  if (sh.getLastRow() < 2) return "لا توجد سجلات للحذف";
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  return "✔ تم حذف جميع السجلات بنجاح";
}

/*******************************
 * جلب بيانات الحجاج للواجهة (نسختك القديمة)
 *******************************/
function getPilgrims() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("قاعدة_البيانات");

  const last = sheet.getLastRow();
  if (last < 2) return [];

  const data = sheet.getRange(2, 1, last - 1, 9).getValues();

  return data.map(r => ({
    name: r[1],
    id: r[2],
    mobile: r[3],
    gender: r[4],
    tawkeel: r[5],
    rami: r[6],
    thabh: r[7]
  }));
}

/*******************************
 * دالة جديدة — جلب كل الحجاج للـ admin_js
 *******************************/
function getAllPilgrims() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("pilgrims_v3");

  if (cached) {
    return JSON.parse(cached);
  }

  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("قاعدة_البيانات");

  const last = sheet.getLastRow();
  if (last < 2) return [];

  const data = sheet.getRange(2, 1, last - 1, 9).getValues();

  cache.put("pilgrims_v3", JSON.stringify(data), 5);

  return data;
}
/*******************************
 * منع التكرار في جلب البيانات
 *******************************/
function getExistingIDs() {
  const sh = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");
  const last = sh.getLastRow();
  if (last < 2) return [];
  const data = sh.getRange(2, 1, last - 1, 1).getValues();
  return data.map(r => String(r[0]).trim());
}

/*******************************
 * تخزين بيانات الاستيراد + تأكيد الاستيراد
 *******************************/
var importedRowsGlobal = [];

function importPilgrimsArray(rows, mode) {
  importedRowsGlobal = rows;
  return "OK";
}

function confirmImport(rows, mode) {
  const sheet = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");

  // حذف القديم إذا اختار المستخدم "replace"
  if (mode === "replace") {
    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  }

  // حماية
  if (!rows || rows.length === 0) {
    return "لا توجد بيانات للاستيراد";
  }

  // تجهيز الصفوف للكتابة
  const mapped = rows.map(r => [
    r[0],      // الهوية
    r[1],      // الجوال
    r[2],      // الاسم
    r[3],      // الجنس
    "",        // التوكيل
    "",        // الرمي
    "",        // الذبح
    ""         // رابط الشهادة
  ]);

  // الكتابة في الشيت
  sheet.getRange(sheet.getLastRow() + 1, 1, mapped.length, 8).setValues(mapped);

  return "تم استيراد " + mapped.length + " سجل بنجاح";
}

/*******************************
 * function doPost
 *******************************/
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const action = data.action;

  if (action === "search") {
    return ContentService
      .createTextOutput(JSON.stringify(searchHaj(data.id)))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "get_tawkeel_text") {
    const txt = getTawkeelText();
    return ContentService
      .createTextOutput(JSON.stringify(txt))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "tawkeel") {
    updateStatus(data.id, "تم التوكيل", 5);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "done", tawkeel: "تم التوكيل" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "cancel_tawkeel") {
    updateStatus(data.id, "", 5);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "done", tawkeel: "" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "rami") {
    updateStatus(data.id, "تم الرمي", 6);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "done", rami: "تم الرمي" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === "cancel_rami") {
    updateStatus(data.id, "", 6);
    return ContentService
      .createTextOutput(JSON.stringify({ status: "done", rami: "" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ error: "unknown_action" }))
    .setMimeType(ContentService.MimeType.JSON);
}
function getAllMarjaList() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("قاعدة_البيانات");

  const last = sh.getLastRow();
  if (last < 2) return [];

  const marjaCol = sh.getRange(2, 9, last - 1, 1).getValues(); // العمود I = رقم 9
  const unique = [...new Set(marjaCol.flat().filter(x => x && x.toString().trim() !== ""))];

  return unique;
}
/* =======================
   Batch Mode — الدالة الجديدة
======================= */
function batchUpdateSlaughter(slaughterList, undoList) {
  const db = SpreadsheetApp.getActive().getSheetByName("قاعدة_البيانات");

  slaughterList.forEach(id => {
    const cell = db.getRange("A:A").createTextFinder(id).findNext();
    if (cell) db.getRange(cell.getRow(), 7).setValue("تم الذبح");
  });

  undoList.forEach(id => {
    const cell = db.getRange("A:A").createTextFinder(id).findNext();
    if (cell) {
      const row = cell.getRow();
      db.getRange(row, 7).setValue("لم يتم");
      db.getRange(row, 8).setValue("");
    }
  });
}