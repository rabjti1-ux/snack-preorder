'use strict';
const { get, run, SHOP_ID } = require('./db');
const { HttpError, nowIso, localParts, zonedToDate, addDays, weekdayOf, str, int, isTime } = require('./util');

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const IMAGE_RE = /^\/(uploads|demo)\/[A-Za-z0-9._-]+$/;

function ensureShop() {
  const row = get('SELECT id FROM shops WHERE id = ?', SHOP_ID);
  if (!row) {
    run(`INSERT INTO shops (id, name, phone, address, business_hours, notice, pickup_slots, lead_minutes, days_ahead, updated_at)
         VALUES (?, ?, '', '', '', '', ?, 30, 2, ?)`,
      SHOP_ID, '我的零食店', JSON.stringify([{ start: '10:00', end: '12:00' }, { start: '15:00', end: '18:00' }]), nowIso());
  }
}

function getShop() {
  const s = get('SELECT * FROM shops WHERE id = ?', SHOP_ID);
  return { ...s, accepting_orders: !!s.accepting_orders, pickup_slots: parseSlots(s.pickup_slots) };
}

function parseSlots(json) {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((s) => isTime(s.start) && isTime(s.end)) : [];
  } catch (_) { return []; }
}

function dayLabel(offset, date) {
  const [, m, d] = date.split('-').map(Number);
  const rel = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : '';
  return { rel, text: `${m}月${d}日 ${WEEK[weekdayOf(date)]}` };
}

// 计算客户现在可以选的取货日期和时段
function pickupOptions(shop, now = new Date()) {
  const today = localParts(now).date;
  const dates = [];
  for (let i = 0; i < shop.days_ahead; i++) {
    const date = addDays(today, i);
    const label = dayLabel(i, date);
    dates.push({
      date,
      rel: label.rel,
      text: label.text,
      slots: shop.pickup_slots.map((s) => {
        const end = zonedToDate(date, s.end);
        const available = end.getTime() - now.getTime() >= shop.lead_minutes * 60_000;
        return { value: `${s.start}-${s.end}`, start: s.start, end: s.end, available };
      }),
    });
  }
  return { today, dates };
}

function publicShop() {
  const s = getShop();
  return {
    name: s.name,
    image: s.image,
    phone: s.phone,
    address: s.address,
    business_hours: s.business_hours,
    notice: s.notice,
    accepting_orders: s.accepting_orders,
    pause_message: s.pause_message,
    lead_minutes: s.lead_minutes,
    days_ahead: s.days_ahead,
    pickup: pickupOptions(s),
    // 收款码：客户下单后可以扫码提前付款
    pay: { wechat_qr: s.pay_wechat_qr, alipay_qr: s.pay_alipay_qr, note: s.pay_note },
  };
}

function validateSlots(slots) {
  if (!Array.isArray(slots)) throw new HttpError(400, 'BAD_INPUT', '取货时段格式不正确');
  if (slots.length === 0) throw new HttpError(400, 'BAD_INPUT', '至少设置一个取货时段');
  if (slots.length > 12) throw new HttpError(400, 'BAD_INPUT', '取货时段最多 12 个');
  const out = slots.map((s) => {
    if (!s || !isTime(s.start) || !isTime(s.end)) throw new HttpError(400, 'BAD_INPUT', '取货时段的时间格式应为 HH:MM');
    if (s.start >= s.end) throw new HttpError(400, 'BAD_INPUT', `时段 ${s.start}-${s.end} 的结束时间要晚于开始时间`);
    return { start: s.start, end: s.end };
  });
  out.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < out.length; i++) {
    if (out[i].start === out[i - 1].start && out[i].end === out[i - 1].end) {
      throw new HttpError(400, 'BAD_INPUT', `时段 ${out[i].start}-${out[i].end} 重复了`);
    }
  }
  return out;
}

function validImage(v) {
  const s = str(v, { field: '图片', max: 300 });
  if (s && !IMAGE_RE.test(s)) throw new HttpError(400, 'BAD_INPUT', '图片地址不正确，请重新上传');
  return s;
}

function updateShop(body) {
  const cur = getShop();
  const next = {
    name: body.name !== undefined ? str(body.name, { field: '店名', required: true, max: 30 }) : cur.name,
    image: body.image !== undefined ? validImage(body.image) : cur.image,
    phone: body.phone !== undefined ? str(body.phone, { field: '联系电话', max: 30 }) : cur.phone,
    address: body.address !== undefined ? str(body.address, { field: '地址', max: 100 }) : cur.address,
    business_hours: body.business_hours !== undefined ? str(body.business_hours, { field: '营业时间', max: 60 }) : cur.business_hours,
    notice: body.notice !== undefined ? str(body.notice, { field: '公告', max: 300 }) : cur.notice,
    pickup_slots: body.pickup_slots !== undefined ? validateSlots(body.pickup_slots) : cur.pickup_slots,
    lead_minutes: body.lead_minutes !== undefined ? int(body.lead_minutes, { field: '提前预订时间', min: 0, max: 4320 }) : cur.lead_minutes,
    days_ahead: body.days_ahead !== undefined ? int(body.days_ahead, { field: '可预约天数', min: 1, max: 14 }) : cur.days_ahead,
    accepting_orders: body.accepting_orders !== undefined ? !!body.accepting_orders : cur.accepting_orders,
    pause_message: body.pause_message !== undefined ? str(body.pause_message, { field: '暂停说明', max: 100 }) : cur.pause_message,
    pay_wechat_qr: body.pay_wechat_qr !== undefined ? validImage(body.pay_wechat_qr) : cur.pay_wechat_qr,
    pay_alipay_qr: body.pay_alipay_qr !== undefined ? validImage(body.pay_alipay_qr) : cur.pay_alipay_qr,
    pay_note: body.pay_note !== undefined ? str(body.pay_note, { field: '付款说明', max: 100 }) : cur.pay_note,
  };
  run(`UPDATE shops SET name=?, image=?, phone=?, address=?, business_hours=?, notice=?, pickup_slots=?,
       lead_minutes=?, days_ahead=?, accepting_orders=?, pause_message=?, pay_wechat_qr=?, pay_alipay_qr=?, pay_note=?,
       updated_at=? WHERE id=?`,
    next.name, next.image, next.phone, next.address, next.business_hours, next.notice, JSON.stringify(next.pickup_slots),
    next.lead_minutes, next.days_ahead, next.accepting_orders ? 1 : 0, next.pause_message,
    next.pay_wechat_qr, next.pay_alipay_qr, next.pay_note, nowIso(), SHOP_ID);
  return getShop();
}

module.exports = { ensureShop, getShop, publicShop, pickupOptions, updateShop, validImage };
