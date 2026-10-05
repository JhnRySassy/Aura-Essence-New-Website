/*************************************************
 * AURA & ESSENCE — ORDER EMAIL NOTIFIER
 *
 * Supabase calls this tiny web app every time a new order
 * is placed, and it emails you, the same as the old MailApp email.
 * It does NOT touch any spreadsheet.
 *
 * SETUP (one time):
 * 1. Go to script.google.com → New project. Paste this whole file.
 * 2. Set ADMIN_EMAIL and WEBHOOK_SECRET below. Make the secret
 *    long and random (e.g. 40 letters and numbers).
 * 3. Run authorizeEmail() once and allow the permissions.
 * 4. Deploy → New deployment → Web app
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the /exec URL.
 * 5. In Supabase → SQL Editor, run (with your URL + the same secret):
 *
 *    insert into private.config (key, value) values
 *      ('order_email_webhook_url',    'PASTE_THE_EXEC_URL'),
 *      ('order_email_webhook_secret', 'PASTE_THE_SAME_SECRET')
 *    on conflict (key) do update set value = excluded.value;
 *
 * Only type your real email and secret inside Apps Script, never in
 * the copy of this file in your GitHub repo.
 *************************************************/

const ADMIN_EMAIL = 'YOUR_EMAIL@gmail.com';
const WEBHOOK_SECRET = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET';
const TIME_ZONE = 'Asia/Manila';


function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (
      !WEBHOOK_SECRET ||
      WEBHOOK_SECRET === 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET' ||
      data.secret !== WEBHOOK_SECRET
    ) {
      return json_({ success: false, message: 'Unauthorized.' });
    }

    sendOrderEmail_(data);
    return json_({ success: true });

  } catch (error) {
    console.error('Order email failed: ' + (error && error.message ? error.message : error));
    return json_({ success: false, message: 'Email failed.' });
  }
}


function doGet() {
  return json_({ success: true, message: 'Aura & Essence order notifier is running.' });
}


function sendOrderEmail_(o) {
  var items = Array.isArray(o.items) ? o.items : [];

  var itemText = items.map(function (i) {
    return i.name + ' × ' + i.qty + ' — ₱' + money_(Number(i.price || 0) * Number(i.qty || 0));
  }).join('\n');

  var discountLine = Number(o.discount || 0) > 0
    ? '<p><b>Promo:</b> ' + esc_(o.promo || 'Discount') + ' (−₱' + money_(o.discount) + ')</p>'
    : '';

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: '🛍️ New Aura & Essence Order - ' + o.orderId,
    htmlBody:
      '<div style="font-family:Arial,sans-serif;max-width:650px;margin:auto;color:#222">' +
        '<div style="background:#111;color:#fff;padding:24px;text-align:center">' +
          '<h1>AURA &amp; ESSENCE</h1><p>New Order Notification</p>' +
        '</div>' +
        '<div style="padding:24px;border:1px solid #ddd">' +
          '<p><b>Order ID:</b> ' + esc_(o.orderId) + '</p>' +
          '<p><b>Date:</b> ' + esc_(o.date || Utilities.formatDate(new Date(), TIME_ZONE, 'MMMM dd, yyyy • hh:mm a')) + '</p>' +
          '<p><b>Customer:</b> ' + esc_(o.fullname) + '</p>' +
          '<p><b>Contact:</b> ' + esc_(o.contact) + '</p>' +
          '<p><b>Items:</b><br>' + esc_(itemText).replace(/\n/g, '<br>') + '</p>' +
          discountLine +
          '<p><b>Total:</b> ₱' + money_(o.total) + '</p>' +
          '<p><b>Delivery / Meetup:</b> ' + esc_(o.address) + '</p>' +
          '<p><b>Payment:</b> ' + esc_(o.payment) + '</p>' +
          '<p><b>Notes:</b> ' + esc_(o.notes || '—') + '</p>' +
          '<p><b>Status:</b> ' + esc_(o.status || 'New') + '</p>' +
        '</div>' +
      '</div>',
    body: [
      'New Aura & Essence order received.',
      'Order ID: ' + o.orderId,
      'Customer: ' + o.fullname,
      'Contact: ' + o.contact,
      'Items:',
      itemText,
      'Total: ₱' + money_(o.total),
      'Delivery / Meetup: ' + o.address,
      'Payment: ' + o.payment,
      'Notes: ' + (o.notes || '—')
    ].join('\n')
  });
}


function money_(v) {
  return Number(v || 0).toLocaleString();
}

function esc_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


/* Run once from the editor to grant email permission. */
function authorizeEmail() {
  MailApp.sendEmail(ADMIN_EMAIL, 'Aura & Essence notifier test', 'Order email notifications are working.');
}
