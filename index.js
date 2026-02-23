const { Client, GatewayIntentBits } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin({ update: false })],
});

const PREFIX = '!';

client.on('ready', () => {
  console.log(`✅ البوت شغال: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const voiceChannel = message.member?.voice?.channel;

  if (command === 'play' || command === 'p') {
    if (!voiceChannel) return message.reply('❌ لازم تكون في روم صوتي!');
    const query = args.join(' ');
    if (!query) return message.reply('❌ اكتب اسم الأغنية أو رابط.');
    try {
      await distube.play(voiceChannel, query, { member: message.member, textChannel: message.channel });
    } catch (err) {
      console.error(err);
      message.reply(`❌ صار خطأ: ${err.message}`);
    }
  }

  else if (command === 'skip' || command === 's') {
    const queue = distube.getQueue(message.guildId);
    if (!queue) return message.reply('❌ ما في شي يشتغل.');
    try {
      await distube.skip(message.guildId);
      message.reply('⏭️ تم التخطي.');
    } catch {
      message.reply('❌ ما في أغنية ثانية في القائمة.');
    }
  }

  else if (command === 'stop') {
    const queue = distube.getQueue(message.guildId);
    if (!queue) return message.reply('❌ ما في شي يشتغل.');
    distube.voices.get(message.guild)?.leave();
    distube.stop(message.guildId);
    message.reply('⏹️ وقفت وطلعت من الروم.');
  }

  else if (command === 'queue' || command === 'q') {
    const queue = distube.getQueue(message.guildId);
    if (!queue || !queue.songs.length) return message.reply('📭 القائمة فارغة.');
    const list = queue.songs.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    message.reply(`📋 **القائمة:**\n${list}`);
  }

  else if (command === 'help') {
    message.reply(
      `**الأوامر:**\n` +
      `\`!play <اسم أو رابط>\` - شغّل أغنية\n` +
      `\`!skip\` - تخطى\n` +
      `\`!stop\` - وقف وطلع\n` +
      `\`!queue\` - عرض القائمة`
    );
  }
});

distube.on('playSong', (queue, song) => {
  queue.textChannel?.send(`▶️ يشتغل الحين: **${song.name}**`);
});

distube.on('addSong', (queue, song) => {
  queue.textChannel?.send(`✅ أضفت للقائمة: **${song.name}**`);
});

distube.on('error', (channel, err) => {
  console.error('DisTube error:', err);
  channel?.send(`❌ صار خطأ: ${err.message}`);
});

client.login(process.env.DISCORD_TOKEN);
