-- A face for everyone in the demo crew, instead of a disc of initials. profiles.avatar holds DiceBear "notionists"
-- options as a query string; the phone draws the face from them (src/components/ui/avatar.tsx), so nothing is fetched.
-- Null keeps the initials. The hair roughly follows the first name: long for Priya, short for Tom, either for Sam.

alter table profiles add column avatar text;

with look(first, kind) as (values
  ('Aisha','f'),('Amelia','f'),('Ava','f'),('Bianca','f'),('Chloe','f'),('Ella','f'),('Emma','f'),('Fatima','f'),
  ('Georgia','f'),('Grace','f'),('Hana','f'),('Isla','f'),('Ivy','f'),('Jade','f'),('Jasmine','f'),('Kate','f'),
  ('Layla','f'),('Lily','f'),('Linh','f'),('Maya','f'),('Mei','f'),('Mia','f'),('Nadia','f'),('Nina','f'),('Paige','f'),
  ('Priya','f'),('Rosa','f'),('Ruby','f'),('Sakura','f'),('Sara','f'),('Sienna','f'),('Sofia','f'),('Tess','f'),
  ('Tiana','f'),('Yasmin','f'),('Zara','f'),('Zoe','f'),
  ('Arjun','m'),('Ben','m'),('Daniel','m'),('Dev','m'),('Eli','m'),('Ethan','m'),('Finn','m'),('Hamish','m'),
  ('Harry','m'),('Hugo','m'),('Jack','m'),('James','m'),('Leo','m'),('Luca','m'),('Lucas','m'),('Marco','m'),('Minh','m'),
  ('Nikos','m'),('Noah','m'),('Oliver','m'),('Omar','m'),('Oscar','m'),('Rahul','m'),('Ryan','m'),('Tariq','m'),
  ('Theo','m'),('Tom','m'),('Will','m'),('Yusuf','m')
),
hair(kind, opts) as (values
  ('f', 'hair=variant02,variant04,variant08,variant10,variant23,variant28,variant36,variant37,variant39,variant41,'
        'variant45,variant46,variant47,variant48,variant57,variant58,variant59,variant61&beardProbability=0'),
  ('m', 'hair=variant01,variant05,variant06,variant07,variant09,variant12,variant13,variant15,variant16,variant17,'
        'variant18,variant19,variant21,variant22,variant24,variant25,variant26,variant27,variant31,variant33,variant34,'
        'variant35,variant38,variant40,variant42,variant44,variant49,variant52,variant53,variant54,variant55,variant56,variant60'),
  -- Alex, Anh, Jordan, Jun, Kai, Kiran, Mo, Quinn, Riley, Sam: any hair, no beard.
  ('x', 'beardProbability=0')
)
update profiles p set avatar = 'seed=' || split_part(u.email, '@', 1) || '&' || h.opts
from auth.users u, hair h
where u.id = p.id and u.email like '%@moloop.test'
  and h.kind = coalesce((select kind from look where first = split_part(p.full_name, ' ', 1)), 'x');
