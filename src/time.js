const timezone='Asia/Shanghai';
const dayMs=86400000;
const formatter=new Intl.DateTimeFormat('zh-CN',{
 timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'long',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
});
function localParts(date){
 const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
 return {...parts,date:`${parts.year}-${parts.month}-${parts.day}`};
}

// Resolve relative dates before sending them to the model, independently of the host timezone.
export function campusTimeContext(now=new Date()){
 const current=new Date(now),p=localParts(current);
 const yesterday=localParts(new Date(current.getTime()-dayMs)).date;
 const tomorrow=localParts(new Date(current.getTime()+dayMs)).date;
 const localTime=`${p.hour}:${p.minute}:${p.second}`;
 return `本轮服务器时钟（北京时间，${timezone}，UTC+08:00）：${p.date} ${p.weekday} ${localTime}。\n当前时间的带时区格式：${p.date}T${localTime}+08:00。\n按北京时间：昨天=${yesterday}；今天=${p.date}；明天=${tomorrow}。\n“现在／今天／明天”以本轮服务器时钟为准，不沿用历史对话中的时间或网页采集时间。查询日程和创建提醒时使用对应日期及 +08:00 时区。\n工具结果中以 Z 结尾的时间是 UTC，须转换为北京时间后再判断日期、星期和是否开始；已带 +08:00 的时间无需再次加 8 小时。`;
}
