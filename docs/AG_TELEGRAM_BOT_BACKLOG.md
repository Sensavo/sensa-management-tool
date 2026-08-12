# AG backlog: Telegram bot Poriadok V1 QA + copy polish

## Контекст
Poriadok має Telegram bot integration у `backend/server.py` для ролей: manager/Юра, marketer/Во, smm/Софійка. Основна реалізація V1 доробляється в коді: ранковий пінг, друга підказка, кнопки, link/unlink, налаштування часу та стилю.

## Що треба підхопити
1. Перевірити tone of voice усіх Telegram-повідомлень після мого V1 commit.
2. Розширити/відполірувати copy library до 30+ фраз без generic AI/motivation/wellness.
3. Зробити QA checklist для Telegram сценаріїв.
4. Після деплою пройти production smoke checklist.

## Правила тону
- lowercase.
- коротко.
- без зайвого шуму.
- без провини, контролю або покарання.
- не використовувати: “без героїзму”, “світ не зламається”, “один маленький крок”, “ти впораєшся”, motivational quotes, pseudo-therapy, corporate positivity.
- mindful-вставки мають бути рідкими й характерними, не “зроби 3 вдихи”.

## QA сценарії
- `TELEGRAM_BOT_TOKEN` відсутній: backend стартує, статус disabled, API живе.
- chat link code створюється, привʼязка працює, старий chat відвʼязується.
- unlink/mute/unmute працюють із UI і бот-кнопок.
- morning preview показує задачі сьогодні + активні залишки з учора/раніше.
- morning ping іде в персональний час 07:00-11:00.
- second ping іде тільки якщо не було реакції на morning, приблизно +5 год, не пізніше 16:00.
- кнопки “все ок/роблю/переглянути день/перенести задачі/відкрити poriadok” не вимагають ручних команд.
- “відкрити poriadok” дає клікабельний deep-link.
- після кількох ігнорів повідомлення не соромить людину, а питає чи пінги ще корисні.
- прод: Railway logs без polling conflict, `/api/admin/telegram/status` показує polling або disabled без токена.

## Очікуваний результат
Короткий звіт: що перевірено, які фрази змінено, які прод-сценарії пройдені, що залишилося на V2.
