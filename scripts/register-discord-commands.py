"""Register the Discord bot's slash commands with Discord.

    set DISCORD_APPLICATION_ID=...   (the application id, from the developer portal)
    set DISCORD_BOT_TOKEN=...        (the bot token, from the portal's Bot page)
    python scripts/register-discord-commands.py [guild id]

Sends scripts/discord-commands.json to Discord, replacing the application's
commands. With a server (guild) id they are registered on that server only,
which shows them at once - the way to try them out; without one they are
global, which can take a while to appear everywhere.

Run it once, and again whenever discord-commands.json changes. The token is
read from the environment and never written anywhere; keep it that way.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

COMMANDS = Path(__file__).resolve().parent / 'discord-commands.json'


def main():
    app = os.environ.get('DISCORD_APPLICATION_ID', '').strip()
    token = os.environ.get('DISCORD_BOT_TOKEN', '').strip()
    if not app or not token:
        sys.exit('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first.')
    guild = sys.argv[1].strip() if len(sys.argv) > 1 else ''
    where = f'guilds/{guild}/commands' if guild else 'commands'
    request = urllib.request.Request(
        f'https://discord.com/api/v10/applications/{app}/{where}',
        data=COMMANDS.read_bytes(),
        method='PUT',
        headers={'Authorization': f'Bot {token}', 'Content-Type': 'application/json', 'User-Agent': 'sheets-bot-setup (1.0)'},
    )
    try:
        with urllib.request.urlopen(request) as response:
            names = [c['name'] for c in json.loads(response.read())]
    except urllib.error.HTTPError as err:
        sys.exit(f'Discord said {err.code}: {err.read().decode(errors="replace")}')
    print(f"Registered {', '.join('/' + n for n in names)} {'on server ' + guild if guild else 'globally'}.")


if __name__ == '__main__':
    main()
