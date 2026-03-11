/**
 * 时间格式化工具函数
 * 支持24小时制和东八区时区
 */

// 东八区时区偏移量（毫秒）
const BEIJING_TIMEZONE_OFFSET = 8 * 60 * 60 * 1000;

/**
 * 将UTC时间转换为北京时间
 * @param date 时间字符串或Date对象
 * @returns 北京时间的Date对象
 */
export function toBeijingTime(date: string | Date | null | undefined): Date | null {
  if (!date) return null;

  const utcDate = new Date(date);

  // 如果是无效日期，返回null
  if (isNaN(utcDate.getTime())) return null;

  // 转换为北京时间（东八区）
  return new Date(utcDate.getTime() + BEIJING_TIMEZONE_OFFSET);
}

/**
 * 格式化时间为24小时制北京时间
 * 格式：YYYY-MM-DD HH:mm:ss
 * @param date 时间字符串或Date对象
 * @returns 格式化后的时间字符串
 */
export function formatBeijingTime(date: string | Date | null | undefined): string {
  const beijingDate = toBeijingTime(date);
  if (!beijingDate) return '';

  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  const hours = String(beijingDate.getHours()).padStart(2, '0');
  const minutes = String(beijingDate.getMinutes()).padStart(2, '0');
  const seconds = String(beijingDate.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 格式化时间为简洁的北京时间（用于列表显示）
 * 格式：MM-DD HH:mm
 * @param date 时间字符串或Date对象
 * @returns 格式化后的时间字符串
 */
export function formatBeijingTimeShort(date: string | Date | null | undefined): string {
  const beijingDate = toBeijingTime(date);
  if (!beijingDate) return '';

  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');
  const hours = String(beijingDate.getHours()).padStart(2, '0');
  const minutes = String(beijingDate.getMinutes()).padStart(2, '0');

  return `${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化时间为北京时间的日期格式（用于完工记录显示）
 * 格式：YYYY-MM-DD
 * @param date 时间字符串或Date对象
 * @returns 格式化后的日期字符串
 */
export function formatBeijingTimeDate(date: string | Date | null | undefined): string {
  const beijingDate = toBeijingTime(date);
  if (!beijingDate) return '';

  const year = beijingDate.getFullYear();
  const month = String(beijingDate.getMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * 格式化时间为完整的北京时间描述（用于详情显示）
 * 格式：YYYY年MM月DD日 HH:mm:ss
 * @param date 时间字符串或Date对象
 * @returns 格式化后的时间字符串
 */
export function formatBeijingTimeFull(date: string | Date | null | undefined): string {
  const beijingDate = toBeijingTime(date);
  if (!beijingDate) return '';

  const year = beijingDate.getFullYear();
  const month = beijingDate.getMonth() + 1;
  const day = beijingDate.getDate();
  const hours = String(beijingDate.getHours()).padStart(2, '0');
  const minutes = String(beijingDate.getMinutes()).padStart(2, '0');
  const seconds = String(beijingDate.getSeconds()).padStart(2, '0');

  return `${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取当前北京时间
 * @returns 当前北京时间的Date对象
 */
export function getCurrentBeijingTime(): Date {
  return toBeijingTime(new Date())!;
}

/**
 * 将北京时间转换为ISO字符串（用于发送到后端）
 * @param date 北京时间的Date对象
 * @returns ISO格式的UTC时间字符串
 */
export function beijingTimeToISOString(date: Date): string {
  // 将北京时间转换为UTC时间
  const utcDate = new Date(date.getTime() - BEIJING_TIMEZONE_OFFSET);
  return utcDate.toISOString();
}
