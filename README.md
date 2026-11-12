# ktm-jwp-tasks

เว็บดู/อัปเดตงานโปรเจกต์ Ktm x Jwp x irori (ส่งมอบ ศ. 15 ม.ค. 2570)

- เปิดผ่าน LINE: https://liff.line.me/2012582367-bQEgRlGx
- หน้าเว็บ: GitHub Pages (index.html, app.js, style.css — ไม่มี build step)
- ข้อมูล: Supabase `line.tasks` (งานที่บอท GOV SECRETARY ใช้ส่งการ์ดในกลุ่ม) + `line.task_details` + ประวัติใน `line.task_changes`
- API: edge function `ktm-board` (`supabase/functions/ktm-board`) ตรวจ LIFF ID token กับ LINE แล้วอ่าน/เขียนผ่าน SQL function ที่บันทึกประวัติ
- สิทธิ์: admin (สโตน) แก้ได้ทุกช่อง + ส่งงานเข้ากลุ่ม · editor แก้ได้เฉพาะงานที่ตัวเองรับผิดชอบ (ความคืบหน้า, กำหนดส่ง, เสร็จแล้ว, จัดซื้อ) · คนใหม่ = รออนุมัติ
- ในโค้ดไม่มีรหัสลับ (LIFF ID และ URL ของ function เป็นค่าสาธารณะ)
