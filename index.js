const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const PREFIX = '!';
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      songs: [],
      player: null,
      connection: null,
      playing: false,
      guildId: null,
      textChannel: null,
    });
  }
  return queues.get(guildId);
}

async function playSong(queue, song) {
  if (!song) {
    queue.playing = false;
    try { queue.connection?.destroy(); } catch {}
    queues.delete(queue.guildId);
    return;
  }

  queue.playing = true;

  try {
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'lowestaudio',
      highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream);
    queue.player.play(resource);
  } catch (err) {
    console.error('Stream error:', err.message);
    queue.songs.shift();
    playSong(queue, queue.songs[0]);
    return;
  }

  queue.player.removeAllListeners(AudioPlayerStatus.Idle);
  queue.player.removeAllListeners('error');

  queue.player.once(AudioPlayerStatus.Idle, () => {
    queue.songs.shift();
    playSong(queue, queue.songs[0]);
  });

  queue.player.once('error', (err) => {
    console.error('Player error:', err.message);
    queue.songs.shift();
    playSong(queue, queue.songs[0]);
  });

  if (queue.textChannel) {
    queue.textChannel.send(`▶️ يشتغل الحين: **${song.title}**`);
  }
}

client.on('ready', () => {
  console.log(`✅ البوت شغال: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // --- PLAY ---
  if (command === 'play' || command === 'p') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply('❌ لازم تكون في روم صوتي!');
    }

    const query = args.join(' ');
    if (!query) return message.reply('❌ اكتب اسم الأغنية أو رابط.');

    let songUrl, songTitle;

    if (ytdl.validateURL(query)) {
      try {
        const info = await ytdl.getBasicInfo(query);
        songUrl = query;
        songTitle = info.videoDetails.title;
      } catch {
        return message.reply('❌ ما قدرت أجيب معلومات الفيديو.');
      }
    } else {
      try {
        const results = await ytSearch(query);
        const video = results.videos[0];
        if (!video) return message.reply('❌ ما لقيت نتائج.');
        songUrl = video.url;
        songTitle = video.title;
      } catch {
        return message.reply('❌ صار خطأ في البحث.');
      }
    }

    const queue = getQueue(message.guildId);
    queue.guildId = message.guildId;
    queue.textChannel = message.channel;

    queue.songs.push({ url: songUrl, title: songTitle });

    // لو البوت بالفعل موصل، شغّل مباشرة
    if (queue.connection) {
      if (!queue.playing) {
        playSong(queue, queue.songs[0]);
      } else {
        message.reply(`✅ أضفت للقائمة: **${songTitle}**`);
      }
      return;
    }

    // اتصال جديد
    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guildId,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      queue.connection = connection;
      queue.player = player;

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          queue.songs = [];
          queue.playing = false;
          try { connection.destroy(); } catch {}
          queues.delete(message.guildId);
        }
      });

      // انتظر الاتصال - timeout كبير للـ VPS
      await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
      playSong(queue, queue.songs[0]);

    } catch (err) {
      console.error('Connection error:', err);
      queues.delete(message.guildId);
      return message.reply('❌ ما قدرت أتصل بالروم الصوتي، حاول مرة ثانية.');
    }
  }

  // --- SKIP ---
  else if (command === 'skip' || command === 's') {
    const queue = queues.get(message.guildId);
    if (!queue || !queue.playing) return message.reply('❌ ما في شي يشتغل.');
    queue.player.stop();
    message.reply('⏭️ تم التخطي.');
  }

  // --- STOP ---
  else if (command === 'stop') {
    const queue = queues.get(message.guildId);
    if (!queue) return message.reply('❌ ما في شي يشتغل.');
    queue.songs = [];
    queue.playing = false;
    try { queue.player?.stop(); } catch {}
    try { queue.connection?.destroy(); } catch {}
    queues.delete(message.guildId);
    message.reply('⏹️ وقفت وطلعت من الروم.');
  }

  // --- QUEUE ---
  else if (command === 'queue' || command === 'q') {
    const queue = queues.get(message.guildId);
    if (!queue || queue.songs.length === 0) return message.reply('📭 القائمة فارغة.');
    const list = queue.songs.map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    message.reply(`📋 **القائمة:**\n${list}`);
  }

  // --- HELP ---
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

client.login(process.env.DISCORD_TOKEN);
