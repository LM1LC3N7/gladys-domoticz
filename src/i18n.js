// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, badges), in English and
// French. Never put a token or a password in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Why Domoticz is unreachable, with the hint that fits. */
function unreachable(err) {
  const reason = err?.message ?? 'unknown error';
  const hints = {
    certificate: {
      en: 'For a self-signed certificate, turn off "Verify the TLS certificate".',
      fr: 'Pour un certificat auto-signé, désactivez « Vérifier le certificat TLS ».',
    },
    redirect: {
      en: 'Type the address Domoticz redirects to.',
      fr: "Saisissez l'adresse vers laquelle Domoticz redirige.",
    },
    http: {
      en: 'Check the address and the port (8080 by default).',
      fr: "Vérifiez l'adresse et le port (8080 par défaut).",
    },
    format: {
      en: 'Is it the address of your Domoticz (with its port)?',
      fr: "Est-ce bien l'adresse de votre Domoticz (avec son port) ?",
    },
  };
  const hint = hints[err?.kind] ?? {
    en: 'Use its LAN IP address and port (not localhost). Retrying in a few seconds.',
    fr: 'Utilisez son adresse IP sur le réseau local et son port (pas localhost). Nouvel essai dans quelques secondes.',
  };
  return {
    en: `Domoticz is unreachable: ${reason}. ${hint.en}`,
    fr: `Domoticz est injoignable : ${reason}. ${hint.fr}`,
  };
}

export const T = {
  notConfigured: {
    en: 'Type the address of your Domoticz (for example http://192.168.1.20:8080) and an access token or a user in the configuration.',
    fr: "Saisissez l'adresse de votre Domoticz (par exemple http://192.168.1.20:8080) et un jeton d'accès ou un utilisateur dans la configuration.",
  },
  noPassword: {
    en: 'Type the password of the Domoticz user in the configuration (or use an access token).',
    fr: "Saisissez le mot de passe de l'utilisateur Domoticz dans la configuration (ou utilisez un jeton d'accès).",
  },
  badUrl: (reason) =>
    reason === 'credentials'
      ? {
          en: 'No user name or password in the address: they have their own fields.',
          fr: "Pas d'utilisateur ni de mot de passe dans l'adresse : ils ont leurs propres champs.",
        }
      : {
          en: 'The address of Domoticz is not valid: use http://192.168.1.20:8080 or https://domoticz.lan.',
          fr: "L'adresse de Domoticz n'est pas valide : utilisez http://192.168.1.20:8080 ou https://domoticz.lan.",
        },
  /** The status of a configuration error (see normalizeConfig). */
  configError(error) {
    if (error === 'empty') {
      return T.notConfigured;
    }
    return error === 'no-password' ? T.noPassword : T.badUrl(error);
  },
  connecting: {
    en: 'Connecting to Domoticz…',
    fr: 'Connexion à Domoticz…',
  },
  connected: (version, devices) => ({
    en: `Connected to Domoticz ${version}: ${plural(devices, 'device', 'devices')} in Discovery.`,
    fr: `Connecté à Domoticz ${version} : ${plural(devices, 'appareil', 'appareils')} dans Découverte.`,
  }),
  /**
   * The status of a failed call (a DomoticzError).
   * @param {'token'|'password'|'none'} authKind how the integration signs in
   */
  failure(err, authKind) {
    if (err?.kind === 'auth') {
      if (authKind === 'token') {
        return {
          en: 'Domoticz refused the access token: create a new one in Setup → More Options → Access Tokens, and paste it in the configuration.',
          fr: "Domoticz a refusé le jeton d'accès : créez-en un nouveau dans Configuration → Plus d'options → Access Tokens, et collez-le dans la configuration.",
        };
      }
      if (authKind === 'password') {
        return {
          en: 'Domoticz refused the user name or the password: check them in Setup → Users.',
          fr: "Domoticz a refusé l'utilisateur ou le mot de passe : vérifiez-les dans Configuration → Utilisateurs.",
        };
      }
      return {
        en: 'Domoticz asks Gladys to sign in: paste an access token (Setup → More Options → Access Tokens) or a user, or add the address of the Gladys machine to the trusted networks (Setup → Settings → Security).',
        fr: "Domoticz demande à Gladys de s'identifier : collez un jeton d'accès (Configuration → Plus d'options → Access Tokens) ou un utilisateur, ou ajoutez l'adresse de la machine Gladys aux réseaux de confiance (Configuration → Paramètres → Sécurité).",
      };
    }
    if (err?.kind === 'twofactor') {
      return {
        en: 'This Domoticz user signs in with two-factor authentication: use an access token instead (Setup → More Options → Access Tokens).',
        fr: "Cet utilisateur Domoticz se connecte avec la double authentification : utilisez plutôt un jeton d'accès (Configuration → Plus d'options → Access Tokens).",
      };
    }
    if (err?.kind === 'forbidden') {
      return {
        en: 'Domoticz refused the access: the user (or the token) needs at least the "User" rights.',
        fr: "Domoticz a refusé l'accès : l'utilisateur (ou le jeton) doit avoir au moins les droits « Utilisateur ».",
      };
    }
    if (err?.kind === 'api') {
      return {
        en: `Domoticz answered with an error: ${err.message}.`,
        fr: `Domoticz a répondu par une erreur : ${err.message}.`,
      };
    }
    return unreachable(err);
  },
  test: {
    ok: ({ version, devices, total, scenes, empty, rooms, auth }) => {
      const how = {
        token: { en: 'with the access token', fr: "avec le jeton d'accès" },
        basic: { en: 'with the user (Basic)', fr: "avec l'utilisateur (Basic)" },
        session: { en: 'with the user (session)', fr: "avec l'utilisateur (session)" },
        none: { en: 'as a trusted network', fr: 'en réseau de confiance' },
      }[auth] ?? { en: '', fr: '' };
      const left = scenes + empty;
      return {
        en:
          `Connection OK ${how.en}, Domoticz ${version}: ${plural(total, 'device', 'devices')}, ${plural(rooms, 'room', 'rooms')}. ` +
          `${plural(devices, 'device', 'devices')} offered in Discovery` +
          (left > 0
            ? `, ${left} left out (${scenes} scenes or groups, ${empty} with nothing to offer).`
            : '.'),
        fr:
          `Connexion OK ${how.fr}, Domoticz ${version} : ${plural(total, 'appareil', 'appareils')}, ${plural(rooms, 'pièce', 'pièces')}. ` +
          `${plural(devices, 'appareil proposé', 'appareils proposés')} dans Découverte` +
          (left > 0
            ? `, ${left} écarté${left === 1 ? '' : 's'} (${scenes} scènes ou groupes, ${empty} sans rien à proposer).`
            : '.'),
      };
    },
  },
  badge: {
    timeout: {
      en: 'Domoticz has heard nothing from this device for a while (sensor timeout).',
      fr: "Domoticz n'a plus de nouvelles de cet appareil depuis un moment (délai du capteur dépassé).",
    },
    hardwareDisabled: {
      en: 'The hardware of this device is disabled in Domoticz.',
      fr: 'Le matériel de cet appareil est désactivé dans Domoticz.',
    },
  },
};
