# Sharkord Client — инструкции проекта

## Правило: папки сборки

- **Dev-версия** (портативная сборка для быстрого локального теста) → папка **`dist/`**.
- **Релизные инсталляторы** (electron-builder) → папка **`release/`**.

Обе папки в `.gitignore`. Релизный дистрибутив, который отдаётся пользователям и на
автообновление, всегда собирается в `release/` (это `directories.output` в
`package.json → build`).

### Команды сборки

| Команда | Что делает | Куда |
|---------|-----------|------|
| `npm run pack:portable` | Портативная сборка (dev, только Windows) | `dist/Sharkord-win32-x64/` |
| `npm run pack` | electron-builder `--dir` (распакованная сборка) | `release/` |
| `npm run dist` | Инсталлятор текущей ОС (NSIS/dmg/AppImage) | `release/` |

Настоящие инсталляторы под все три ОС собираются в CI (см. ниже) — локально на этой
машине `npm run dist` под Windows не проходит (electron-builder падает на распаковке
`winCodeSign` из-за выключенного Windows Developer Mode). Это чисто локальное
ограничение; на GitHub-раннерах сборка идёт нормально.

## Сборка и релиз (GitHub Actions, 3 ОС сразу)

`.github/workflows/release.yml` — матрица `windows-latest / macos-latest /
ubuntu-latest`, каждая собирает свой инсталлятор через **electron-builder**:

- Windows → `Sharkord-<ver>-x64.exe` (NSIS-установщик) + `latest.yml`
- Linux → `Sharkord-<ver>-x64.AppImage` + `latest-linux.yml`
- macOS → `Sharkord-<ver>-x64.dmg` (+ `.zip`) + `latest-mac.yml` (**без подписи**)

Триггеры:
- пуш тега `vX.Y.Z` → сборка на всех ОС + публикация GitHub Release (job `publish`);
- пуш в ветку `ci/**` или ручной `workflow_dispatch` → только сборка (проверка без публикации).

Выпуск релиза:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

Каждая ОС собирается на своём раннере и заливает артефакты в общий workflow-artifact;
финальная job `publish` (ubuntu) собирает их и публикует один релиз через `gh release
create`.

## Автообновление

Через **electron-updater** (штатный для electron-builder). Репозиторий берётся из
`package.json → build.publish` (`cr1gger/sharkord-desktop-client`). Клиент при старте
читает `latest*.yml` из последнего GitHub Release.

- **Windows / Linux** — полноценно: тихо качает новый инсталлятор и ставит с
  перезапуском (`autoDownload` + `quitAndInstall`).
- **macOS** — авто-обновление ОТКЛЮЧЕНО (`updatesSupported()` возвращает false на
  `darwin`): Squirrel.Mac требует платной подписи Apple. Пользователь скачивает новый
  `.dmg` вручную с GitHub Releases.

## Прочее

- Иконки генерируются `scripts/gen-icons.js` (чистый JS, без нативной сборки):
  `icon.png` 512px, многоразмерный `icon.ico`, `icon.icns` (через `png2icons`).
  Входит в `pack`/`dist`; в CI запускается перед electron-builder.
