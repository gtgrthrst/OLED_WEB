'use strict';
// Google Material Icons – codepoint-based canvas renderer
// Codepoints loaded from /api/material-icons (Go server proxies GitHub)

// ── Codepoints & font loading ─────────────────────────────────────────────
let _codepoints = {};          // name → hex string, e.g. "e88a"
let _cpLoaded   = false;
let _cpLoading  = null;        // Promise in flight

let _fontReady  = false;
let _fontWait   = null;

async function _ensureFont() {
  if (_fontReady) return;
  if (_fontWait) return _fontWait;
  _fontWait = document.fonts.load('32px "Material Icons"')
    .then(() => { _fontReady = true; })
    .catch(() => {});          // best-effort
  return _fontWait;
}

async function loadCodepoints() {
  if (_cpLoaded) return;
  if (_cpLoading) return _cpLoading;
  _cpLoading = fetch('/api/material-icons')
    .then(r => r.json())
    .then(data => { _codepoints = data; _cpLoaded = true; })
    .catch(() => { _cpLoaded = true; }); // silent fail → ligature fallback
  return _cpLoading;
}

/** Unicode character for an icon name.
 *  Prefers direct codepoint; falls back to ligature string. */
function iconChar(name) {
  const hex = _codepoints[name];
  return hex ? String.fromCodePoint(parseInt(hex, 16)) : name;
}

// ── Renderer ──────────────────────────────────────────────────────────────
const _renderCache = new Map();

/**
 * Render a Material Icon to a binary pixel grid.
 * @returns {grid: number[][], valid: boolean, litPct: number}
 */
async function materialIconToGrid(name, size) {
  const key = `${name}:${size}`;
  if (_renderCache.has(key)) return _renderCache.get(key);

  await _ensureFont();
  await loadCodepoints();

  const char = iconChar(name);

  // ── 4× supersampling ─────────────────────────────────────────────────
  const SCALE = 4;
  const bigSize = size * SCALE;

  const hires = document.createElement('canvas');
  hires.width = hires.height = bigSize;
  const hctx = hires.getContext('2d');
  hctx.fillStyle = '#000';
  hctx.fillRect(0, 0, bigSize, bigSize);
  hctx.fillStyle = '#fff';
  hctx.font = `${bigSize}px "Material Icons"`;
  hctx.textBaseline = 'middle';
  hctx.textAlign = 'center';
  hctx.fillText(char, bigSize / 2, bigSize / 2);

  // ── Downsample with bilinear smoothing ────────────────────────────────
  const lores = document.createElement('canvas');
  lores.width = lores.height = size;
  const lctx = lores.getContext('2d');
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  lctx.drawImage(hires, 0, 0, size, size);

  const imgData = lctx.getImageData(0, 0, size, size).data;

  // ── Adaptive threshold ────────────────────────────────────────────────
  // Collect brightness of all pixels (red channel = grey for white-on-black)
  let maxBright = 0, totalBright = 0, brightCount = 0;
  for (let i = 0; i < size * size; i++) {
    const v = imgData[i * 4];
    if (v > 4) { totalBright += v; brightCount++; maxBright = Math.max(maxBright, v); }
  }

  // Threshold: use 30% of the max brightness; clamp 16–128
  // This handles both thick strokes (high maxBright) and thin ones (low maxBright)
  let threshold = maxBright > 0 ? Math.max(16, Math.min(128, maxBright * 0.30)) : 64;

  // For small sizes (≤12) lower the threshold further (strokes are very thin)
  if (size <= 12) threshold = Math.min(threshold, 24);

  const grid = [];
  let litCount = 0;
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      const v = imgData[(y * size + x) * 4] > threshold ? 1 : 0;
      row.push(v);
      if (v) litCount++;
    }
    grid.push(row);
  }

  const litPct = litCount / (size * size);
  const valid  = litCount > 0;

  const result = { grid, valid, litPct };
  if (valid) _renderCache.set(key, result);   // only cache valid renders
  return result;
}

// ── Curated icon list (all verified to exist in MaterialIcons-Regular) ────
// (17 icons absent from the classic font have been removed)
const MATERIAL_ICON_CATS = {
  '導覽': [
    'home','menu','apps','arrow_back','arrow_forward','arrow_upward','arrow_downward',
    'chevron_left','chevron_right','expand_less','expand_more','unfold_less','unfold_more',
    'first_page','last_page','more_horiz','more_vert',
    'close','cancel','check','done','done_all',
    'fullscreen','fullscreen_exit','refresh','subdirectory_arrow_right',
    'open_in_new','launch','swap_horiz','swap_vert',
  ],
  '狀態': [
    'battery_full','battery_5_bar','battery_3_bar','battery_1_bar','battery_0_bar',
    'battery_charging_full','battery_unknown',
    'wifi','wifi_off','wifi_lock','wifi_tethering','signal_wifi_off',
    'bluetooth','bluetooth_connected','bluetooth_disabled','bluetooth_searching',
    'signal_cellular_4_bar','signal_cellular_0_bar',
    'signal_cellular_off','signal_cellular_connected_no_internet_4_bar',
    'nfc','network_check','network_wifi','gps_fixed','gps_not_fixed','gps_off',
    'lock','lock_open','no_encryption','security','verified_user','shield',
    'cloud','cloud_done','cloud_off','sync','sync_disabled','sync_problem',
  ],
  '提示': [
    'notifications','notifications_active','notifications_none','notifications_off',
    'notifications_paused','circle_notifications',
    'alarm','alarm_on','alarm_off','alarm_add',
    'error','error_outline','warning','warning_amber',
    'info','info_outline','help','help_outline','help_center',
    'notification_important','announcement','new_releases','campaign',
    'report','report_problem','priority_high','low_priority',
    'feedback','quiz','live_help',
  ],
  '多媒體': [
    'play_arrow','pause','stop','replay','replay_5','replay_10','replay_30',
    'skip_next','skip_previous','fast_forward','fast_rewind',
    'shuffle','repeat','repeat_one','loop',
    'volume_up','volume_down','volume_mute','volume_off',
    'mic','mic_none','mic_off','hearing','hearing_disabled',
    'music_note','music_video','album','queue_music','playlist_play','playlist_add',
    'radio','speaker','headphones','headset','surround_sound',
    'videocam','videocam_off','movie','play_circle','pause_circle','stop_circle',
    'picture_in_picture','airplay','cast','cast_connected','screen_share',
  ],
  '動作': [
    'settings','settings_applications','settings_brightness','settings_power',
    'settings_accessibility','settings_backup_restore','tune','build','build_circle',
    'search','search_off','zoom_in','zoom_out','zoom_in_map','zoom_out_map',
    'add','remove','add_circle','remove_circle','add_circle_outline','remove_circle_outline',
    'edit','delete','delete_forever','delete_outline','save','save_alt',
    'send','reply','forward','share','content_copy','content_cut','content_paste',
    'star','star_border','star_half','grade',
    'favorite','favorite_border','heart_broken',
    'thumb_up','thumb_down','thumb_up_alt','thumb_down_alt',
    'bookmark','bookmark_border','bookmark_add','bookmark_added','bookmark_remove',
    'link','link_off','open_in_browser','attach_file',
    'download','upload','cloud_download','cloud_upload','file_download','file_upload',
    'print','print_disabled','qr_code','qr_code_scanner','qr_code_2',
    'power_settings_new','power','flash_on','flash_off','bolt',
    'lock','lock_open','vpn_lock','enhanced_encryption','fingerprint',
    'visibility','visibility_off','preview','pageview',
    'undo','redo','history','restore','update','autorenew',
  ],
  '通訊': [
    'call','call_end','call_made','call_received','call_missed','call_split',
    'phone','phone_enabled','phone_disabled','phone_forwarded','phone_locked',
    'smartphone','tablet','tablet_android','laptop','desktop_windows','computer',
    'email','mail_outline','mark_email_read','mark_email_unread','unsubscribe',
    'message','sms','sms_failed','mms',
    'chat','chat_bubble','chat_bubble_outline','comment','forum','question_answer',
    'inbox','drafts','reply_all','forward_to_inbox',
    'person','person_outline','person_add','person_remove','person_off',
    'group','group_add','group_remove','group_off','groups','people',
    'account_circle','account_box','manage_accounts','contact_page','contacts',
    'video_call','video_chat',
  ],
  '天氣': [
    'wb_sunny','wb_cloudy','wb_twilight','wb_shade','brightness_5','brightness_6','brightness_7',
    'nights_stay','dark_mode','light_mode','wb_incandescent',
    'cloud','cloud_queue','cloud_circle',
    'grain','ac_unit','snowing',
    'opacity','water','water_drop','invert_colors',
    'air','wind_power','thermostat','device_thermostat',
    'umbrella','beach_access','pool','hot_tub','spa',
    'severe_cold','fireplace','local_fire_department',
  ],
  '地圖': [
    'location_on','location_off','location_searching','location_disabled',
    'place','my_location','near_me','near_me_disabled',
    'navigation','explore','compass_calibration','map','satellite','terrain','layers',
    'directions','directions_run','directions_walk','directions_bike',
    'directions_car','directions_bus','directions_railway','directions_subway',
    'directions_boat','flight','electric_scooter','electric_bike',
    'traffic','local_gas_station','local_parking','local_hospital',
    'local_pharmacy','local_cafe','local_restaurant','local_bar',
    'local_mall','local_atm','local_post_office','local_library',
    'pin_drop','tour','attractions','hotel','home_work','business',
  ],
  '裝置': [
    'memory','developer_board','developer_board_off','cable',
    'sd_card','sd_card_alert','sim_card','sim_card_download',
    'usb','usb_off','hub','device_hub',
    'keyboard','keyboard_alt','keyboard_hide','keyboard_arrow_down',
    'mouse','touch_app','swipe','gesture',
    'router','scanner','print','monitor','tv','desktop_mac',
    'watch','watch_off','sensors','sensors_off',
    'cast','cast_connected','cast_for_education',
  ],
  '時間': [
    'access_time','access_alarm','access_time_filled',
    'schedule','timer','timer_off','timer_3','timer_10',
    'hourglass_empty','hourglass_full','hourglass_top','hourglass_bottom','hourglass_disabled',
    'av_timer','alarm','alarm_on','alarm_off','alarm_add',
    'watch_later','pending','pending_actions','event','event_available','event_busy',
    'date_range','calendar_today','calendar_month','today',
    'history','history_toggle_off','restore','update','autorenew','replay',
  ],
  '物聯網': [
    'lightbulb','lightbulb_outline','light','highlight','light_mode',
    'electrical_services','outlet','ev_station','charging_station','electric_meter',
    'power','power_off','power_input',
    'hub','device_hub','router','cable',
    'sensors','sensors_off',
    'thermostat','thermostat_auto','hvac',
    'door_front','door_back','meeting_room','no_meeting_room',
    'garage','window','blinds','curtains','curtains_closed',
    'security','camera','videocam','doorbell',
    'water_damage','flood','propane','propane_tank',
    'solar_power','wind_power','battery_saver','battery_charging_full',
  ],
  '形狀': [
    'circle','panorama_fish_eye','adjust',
    'square','crop_square','crop_16_9','crop_3_2',
    'change_history','details',
    'star_rate',
    'radio_button_checked','radio_button_unchecked',
    'check_box','check_box_outline_blank','indeterminate_check_box',
    'toggle_on','toggle_off',
    'crop','crop_free','crop_portrait','crop_landscape','crop_rotate',
    'straighten','linear_scale','timeline','data_usage',
    'bar_chart','stacked_bar_chart','pie_chart','area_chart','scatter_plot','bubble_chart',
    'show_chart','candlestick_chart','waterfall_chart','leaderboard',
  ],
};

function searchIcons(query) {
  if (!query) return null;
  const q = query.toLowerCase().replace(/\s+/g, '_');
  const results = [], seen = new Set();
  for (const names of Object.values(MATERIAL_ICON_CATS)) {
    for (const name of names) {
      if (!seen.has(name) && name.includes(q)) { results.push(name); seen.add(name); }
    }
  }
  return results;
}
