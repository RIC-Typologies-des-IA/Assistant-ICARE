const activityParams = new URLSearchParams(window.location.search);
if (activityParams.has("frame_id")) {
  (async () => {
    try {
      const configResponse = await fetch("/api/discord/config");
      const config = await configResponse.json();
      if (!configResponse.ok || !config.enabled || !config.clientId) {
        throw new Error("L'Activity Discord n'est pas configurée sur cette installation ICARE.");
      }
      const { DiscordSDK, Events } = await import("https://esm.sh/@discord/embedded-app-sdk@2.5.0");
      const discordSdk = new DiscordSDK(config.clientId);
      await discordSdk.ready();

      const { code } = await discordSdk.commands.authorize({
        client_id: config.clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify", "applications.commands"]
      });
      const tokenResponse = await fetch("/api/discord/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenPayload.access_token) {
        throw new Error(tokenPayload.error || "Échec de l'authentification Discord.");
      }
      const auth = await discordSdk.commands.authenticate({
        access_token: tokenPayload.access_token
      });
      if (!auth?.user) throw new Error("Discord n'a pas fourni d'identité utilisateur.");

      const initialParticipants = await discordSdk.commands.getActivityInstanceConnectedParticipants();
      const onParticipantsUpdate = payload => {
        window.dispatchEvent(new CustomEvent("icare:discord-participants", {
          detail: { participants: payload?.participants || [] }
        }));
      };
      await discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, onParticipantsUpdate);

      const contextResponse = await fetch("/api/discord/context", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + tokenPayload.access_token
        },
        body: JSON.stringify({ channelId: discordSdk.channelId || "", guildId: discordSdk.guildId || "", instanceId: discordSdk.instanceId || "" })
      });
      const context = await contextResponse.json();
      if (!contextResponse.ok) throw new Error(context.error || "Contexte Discord indisponible.");

      window.__icareDiscordSdk = discordSdk;
      window.__icareDiscordParticipantsUnsubscribe = () => discordSdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, onParticipantsUpdate);
      window.dispatchEvent(new CustomEvent("icare:discord-ready", {
        detail: {
          context,
          channelId: discordSdk.channelId || null,
          guildId: discordSdk.guildId || null,
          instanceId: discordSdk.instanceId || null,
          participants: initialParticipants?.participants || [],
          user: auth.user,
          accessToken: tokenPayload.access_token
        }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("icare:discord-error", {
        detail: { message: error.message || String(error) }
      }));
    }
  })();
}
