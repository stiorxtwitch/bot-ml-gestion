// ============================================
// ML DEVLOPPING — Bot Discord
// ============================================
// Installation: npm install discord.js @supabase/supabase-js node-fetch
// Node.js 18+ recommandé
// ============================================

const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

// ── CONFIG — Variables d'environnement ──────
// Ne jamais mettre les tokens en dur dans le code !
// Définissez ces variables dans Render → Environment
const DISCORD_TOKEN       = process.env.DISCORD_TOKEN;
const GUILD_ID            = process.env.GUILD_ID;
const ORDERS_CATEGORY_ID  = process.env.ORDERS_CATEGORY_ID;
const CONTACTS_CATEGORY_ID = process.env.CONTACTS_CATEGORY_ID;
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_KEY        = process.env.SUPABASE_KEY;

// Vérification au démarrage
const REQUIRED_ENV = ['DISCORD_TOKEN','GUILD_ID','ORDERS_CATEGORY_ID','CONTACTS_CATEGORY_ID','SUPABASE_URL','SUPABASE_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variable d'environnement manquante : ${key}`);
    process.exit(1);
  }
}
// ──────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const STATUS_LABELS = {
  pending:      '⏳ En attente',
  en_cours:     '⚙️ En cours',
  preparation:  '🎨 Préparation',
  finalisation: '🔍 Finalisation',
  termine:      '✅ Terminée',
};

// ── BOT READY ──────────────────────────────
client.once('ready', () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  // Polling toutes les 10 secondes
  setInterval(checkNotifications, 10000);
});

// ── POLL : vérifier nouvelles notifs ──────────────────
async function checkNotifications() {
  try {
    const { data: notifs, error } = await supabase
      .from('discord_notifications')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true });

    if (error || !notifs?.length) return;

    for (const notif of notifs) {
      if (notif.type === 'order' && notif.order_id) {
        await handleNewOrder(notif);
      } else if (notif.type === 'contact' && notif.contact_id) {
        // Si le contact a déjà un channel Discord → c'est un message de suivi du client
        const { data: contact } = await supabase.from('contacts').select('*').eq('id', notif.contact_id).single();
        if (contact?.discord_channel_id) {
          await handleClientReply(contact);
        } else {
          await handleNewContact(notif);
        }
      }
      // Marquer comme traité
      await supabase.from('discord_notifications').update({ processed: true }).eq('id', notif.id);
    }
  } catch (err) {
    console.error('Erreur polling:', err);
  }
}

// ── NOUVELLE COMMANDE ──────────────────────
async function handleNewOrder(notif) {
  const { data: orders } = await supabase.from('orders').select('*').eq('id', notif.order_id).single();
  if (!orders) return;
  const order = orders;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return console.error('Guild introuvable.');

  // Compter les commandes existantes pour le numéro
  const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true }).not('discord_channel_id', 'is', null);
  const channelNum = String((count || 0) + 1).padStart(2, '0');
  const channelName = `commande${channelNum}`;

  // Créer le channel dans la catégorie Commandes
  const channel = await guild.channels.create({
    name: channelName,
    type: 0, // GUILD_TEXT
    parent: ORDERS_CATEGORY_ID,
    topic: `Commande #${order.id} — ${order.client_username} — ${order.plan}`,
  });

  // Enregistrer l'ID du channel dans la BDD
  await supabase.from('orders').update({ discord_channel_id: channel.id }).eq('id', order.id);

  // Embed de récapitulatif
  const embed = new EmbedBuilder()
    .setColor(0x1a3dbf)
    .setTitle(`📦 Nouvelle commande #${order.id}`)
    .setDescription(`**${order.plan}** — ${order.price}€/mois`)
    .addFields(
      { name: '👤 Client', value: order.client_name || 'N/A', inline: true },
      { name: '🏷️ Username', value: order.client_username || 'N/A', inline: true },
      { name: '📧 Email', value: order.client_email || 'N/A', inline: true },
      { name: '📋 Description', value: order.description || '*Aucune description*', inline: false },
      { name: '📌 Statut actuel', value: STATUS_LABELS[order.status], inline: true },
      { name: '🕐 Date', value: new Date(order.created_at).toLocaleString('fr-FR'), inline: true },
    )
    .setFooter({ text: 'ML Devlopping — Panel de gestion' })
    .setTimestamp();

  const commandsHelp = [
    '**Commandes disponibles :**',
    '`^^en_cours` — Marquer en cours',
    '`^^preparation` — Marquer en préparation',
    '`^^finalisation` — Marquer en finalisation',
    '`^^terminer` — Marquer comme terminée',
    '`^^contact <message>` — Envoyer un message au client (via la BDD)',
    '',
    '> Le statut est mis à jour **en temps réel** sur le site du client.',
  ].join('\n');

  await channel.send({ embeds: [embed] });
  await channel.send(commandsHelp);

  console.log(`✅ Channel créé : #${channelName} pour commande #${order.id}`);
}

// ── NOUVEAU CONTACT ──────────────────────
async function handleNewContact(notif) {
  const { data: contact } = await supabase.from('contacts').select('*').eq('id', notif.contact_id).single();
  if (!contact) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true }).not('discord_channel_id', 'is', null);
  const channelNum = String((count || 0) + 1).padStart(2, '0');
  const channelName = `contact${channelNum}`;

  const channel = await guild.channels.create({
    name: channelName,
    type: 0,
    parent: CONTACTS_CATEGORY_ID,
    topic: `Contact #${contact.id} — ${contact.email} — ${contact.subject}`,
  });

  await supabase.from('contacts').update({ discord_channel_id: channel.id }).eq('id', contact.id);

  const embed = new EmbedBuilder()
    .setColor(0x2d5be3)
    .setTitle(`✉️ Nouveau message de contact #${contact.id}`)
    .addFields(
      { name: '👤 Nom', value: `${contact.first_name} ${contact.last_name}`, inline: true },
      { name: '📧 Email', value: contact.email, inline: true },
      { name: '📌 Objet', value: contact.subject, inline: false },
      { name: '💬 Message', value: contact.message, inline: false },
      { name: '🕐 Date', value: new Date(contact.created_at).toLocaleString('fr-FR'), inline: true },
    )
    .setFooter({ text: 'ML Devlopping — Formulaire de contact' })
    .setTimestamp();

  const helpText = [
    '**Commandes disponibles :**',
    '`^^answer <votre message>` — Envoyer un email de réponse au client',
    '',
    '> ⚠️ Note : La réponse sera enregistrée dans la BDD. Intégrez un service email (ex: Resend, SendGrid) pour l\'envoi réel.',
  ].join('\n');

  await channel.send({ embeds: [embed] });
  await channel.send(helpText);

  console.log(`✅ Channel contact créé : #${channelName}`);
}

// ── MESSAGE DE SUIVI DU CLIENT ──────────────
async function handleClientReply(contact) {
  // Récupérer le dernier message 'in' non encore relayé
  const { data: msgs } = await supabase
    .from('discord_messages')
    .select('*')
    .eq('contact_id', contact.id)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!msgs?.length) return;
  const lastMsg = msgs[0];

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const channel = guild.channels.cache.get(contact.discord_channel_id);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x4f7af8)
    .setTitle(`💬 Nouveau message du client`)
    .setDescription(lastMsg.content)
    .addFields(
      { name: '👤 Client', value: `${contact.first_name} ${contact.last_name}`, inline: true },
      { name: '📧 Email', value: contact.email, inline: true },
    )
    .setFooter({ text: `Contact #${contact.id} — répondez avec ^^answer <message>` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  console.log(`📨 Message client relayé dans #${channel.name}`);
}


// ── COMMANDES DISCORD ──────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  const channelId = message.channel.id;
  const channelName = message.channel.name;

  // ── COMMANDES COMMANDE ──
  if (channelName.startsWith('commande')) {
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('discord_channel_id', channelId)
      .single();

    if (!order) return;

    // Changements de statut
    const statusCommands = {
      '^^en_cours':     'en_cours',
      '^^preparation':  'preparation',
      '^^finalisation': 'finalisation',
      '^^terminer':     'termine',
    };

    if (statusCommands[content]) {
      const newStatus = statusCommands[content];
      await supabase.from('orders').update({ status: newStatus }).eq('id', order.id);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ Statut mis à jour')
        .setDescription(`Commande #${order.id} → **${STATUS_LABELS[newStatus]}**`)
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
      await message.react('✅');
      console.log(`Commande #${order.id} → statut: ${newStatus}`);
      return;
    }

    // ^^contact <message> — envoyer un message visible sur le site
    if (content.startsWith('^^contact ')) {
      const msg = content.slice('^^contact '.length).trim();
      if (!msg) return message.reply('❌ Syntaxe : `^^contact <votre message>`');

      await supabase.from('orders').update({ ml_message: msg }).eq('id', order.id);
      // Enregistrer dans discord_messages
      await supabase.from('discord_messages').insert({
        order_id: order.id,
        direction: 'out',
        content: msg,
      });

      const embed = new EmbedBuilder()
        .setColor(0x4f7af8)
        .setTitle('💬 Message envoyé au client')
        .setDescription(msg)
        .setFooter({ text: `Visible sur le site dans l'espace client` })
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
      await message.react('📨');
      return;
    }
  }

  // ── COMMANDES CONTACT ──
  if (channelName.startsWith('contact')) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('*')
      .eq('discord_channel_id', channelId)
      .single();

    if (!contact) return;

    // ^^answer <message>
    if (content.startsWith('^^answer ')) {
      const reply = content.slice('^^answer '.length).trim();
      if (!reply) return message.reply('❌ Syntaxe : `^^answer <votre réponse>`');

      // Enregistrer la réponse en BDD
      await supabase.from('discord_messages').insert({
        contact_id: contact.id,
        direction: 'out',
        content: reply,
      });
      await supabase.from('contacts').update({ status: 'replied' }).eq('id', contact.id);

      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('📨 Réponse enregistrée')
        .addFields(
          { name: 'Destinataire', value: `${contact.first_name} ${contact.last_name} (${contact.email})`, inline: false },
          { name: 'Message', value: reply, inline: false },
        )
        .setFooter({ text: '⚠️ Intégrez un service email pour l\'envoi réel (Resend, SendGrid...)' })
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });
      await message.react('✅');
      return;
    }
  }
});

// ── DÉMARRAGE ──────────────────────────────
client.login(DISCORD_TOKEN).catch(err => {
  console.error('Erreur de connexion Discord:', err);
  process.exit(1);
});
