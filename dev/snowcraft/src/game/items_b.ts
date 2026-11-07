// Group 2 of DESIGN §17 («Ориентиры и безопасность», «Свет и сигналы»), agent U2: item definitions. Use actions: useitems_b.ts.
// gearMods: body modifiers the ice cleats set every frame (useitems_b.ts) and player.ts reads for friction and walking speed (usemods.ts pattern).
// No imports on purpose: items.ts imports this file, and player.ts reads gearMods without a cycle.
import { def } from './itemreg';

export const gearMods = { fric: 1, speed: 1 };

def('compass', 'Компас', 'misc', 0.2, 1, { quick: true, desc: 'Стрелка на цель: станция, шхуна, сигнальный холм, дым и твои метки. Нажми — следующая цель. Держи 0,6 с — отметить здесь метку. Виден и в буран.' });
def('binoculars', 'Бинокль', 'misc', 0.6, 1, { quick: true, desc: 'Держи ЛКМ: камера смотрит вдаль в два раза дальше. Когда есть свет (луна, сияние, сумерки), видны метки зверей на большом расстоянии.' });
def('probe_pole', 'Шест-щуп', 'misc', 1.2, 1, { quick: true, desc: 'Ткни в снег перед собой: на шесть шагов покажет толщину льда, полыньи и пустоты под снегом. Делается из плавника и верёвки.' });
def('ice_cleats', 'Ледоступы', 'misc', 0.9, 1, { quick: true, desc: 'Шипы на обувь. На голом льду держат, на гладком от ветра льду быстрее, в рыхлом снеге вязнешь. Нужны ботинки или валенки.' });
def('smoke_flare', 'Дымовая шашка', 'misc', 0.4, 2, { quick: true, desc: 'Густой дым на три минуты: виден издалека днём и в сумерках. Ледокол принимает его как сигнал, как ракету.' });
def('whistle', 'Свисток', 'misc', 0.02, 1, { quick: true, desc: 'Свистни: Север прибежит и пойдёт за тобой. Держи — пусть ждёт на месте.' });
