/**
 * 全项目统一使用东八区（中国时间）。
 * 必须作为入口最先加载，以便 cron、日志、系统提示词等所有 Date 使用东八区。
 */
if (!process.env.TZ) process.env.TZ = 'Asia/Shanghai';
