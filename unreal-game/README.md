# Unreal Engine game via MCP — starter kit

Кит для запуска **локального** Claude Code на вашем ПК. Облачная сессия не может запустить Unreal Editor, поэтому игру собирает агент на ПК, а здесь лежат бриф и правила.

## Быстрый старт (Windows)
1. Установите Unreal Engine (5.7+; для встроенного MCP — 5.8+) через Epic Games Launcher.
2. Создайте проект: Games → Third Person, C++ или Blueprint, Starter Content включить. Назовите `ArenaRush`.
3. Включите MCP:
   - UE 5.8+: Edit → Plugins → найдите «MCP» (экспериментальный Unreal MCP, см. https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor), перезапустите редактор.
   - Иначе — любой сторонний сервер: https://github.com/chir24/unreal_mcp
4. В папке проекта скопируйте `CLAUDE.md` и `BRIEF.md` из этого каталога.
5. В терминале в папке проекта: `claude`, затем подключите MCP-сервер по инструкции плагина (`claude mcp add ...`).
6. Скажите агенту: «Прочитай BRIEF.md и сделай этап 1».

## Файлы
- `BRIEF.md` — что за игра и этапы.
- `CLAUDE.md` — правила и цикл работы агента.
