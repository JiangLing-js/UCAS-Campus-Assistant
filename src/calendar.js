// RFC 5545 folds content lines at 75 octets without splitting UTF-8 characters.
export function foldLine(line){let result='',width=0;for(const char of line){const size=Buffer.byteLength(char);if(width+size>75){result+='\r\n ';width=1;}result+=char;width+=size;}return result;}
export function calendar(items,at=new Date()){
 const escape=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const stamp=s=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UCAS Companion//CN','CALSCALE:GREGORIAN'];
 for(const i of items.filter(i=>i.startsAt&&['course','deadline','reminder'].includes(i.kind))){lines.push('BEGIN:VEVENT',`UID:${i.id}@ucas-companion.local`,`DTSTAMP:${stamp(at)}`,`DTSTART:${stamp(i.startsAt)}`,`DTEND:${stamp(i.endsAt||new Date(Date.parse(i.startsAt)+1800000))}`,`SUMMARY:${escape(i.title)}`,`LOCATION:${escape(i.location)}`,`DESCRIPTION:${escape(i.content)}`);if(i.remindMinutes!=null)lines.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escape(i.title)}`,`TRIGGER:-PT${i.remindMinutes}M`,'END:VALARM');lines.push('END:VEVENT');}
 lines.push('END:VCALENDAR');return lines.map(foldLine).join('\r\n')+'\r\n';
}
