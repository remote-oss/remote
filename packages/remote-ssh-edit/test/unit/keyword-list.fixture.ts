/**
 * @fileoverview The completion list of F-4201 section 3.4 as test data: the 96 labels in their order and, for the
 * 88 keywords whose documentation must begin with a quoted sentence, that sentence. Null marks the snippet and the
 * seven keywords whose documentation is only required to be present.
 */

/** One row of the list: the label and the sentence its documentation begins with, if any. */
export const EXPECTED_ITEMS: Array<[string, string | null]> = [
  [
    'AddKeysToAgent',
    'Specifies whether keys should be automatically added to a running ssh-agent(1).',
  ],
  ['AddressFamily', 'Specifies which address family to use when connecting.'],
  ['AskPassGUI', null],
  [
    'BatchMode',
    "If set to ``yes ,'' passphrase/password querying will be disabled.",
  ],
  [
    'BindAddress',
    'Use the specified address on the local machine as the source address of the connection.',
  ],
  [
    'CanonicalDomains',
    'When CanonicalizeHostname is enabled, this option specifies the list of domain suffixes in which to search for the specified destination host.',
  ],
  [
    'CanonicalizeFallbackLocal',
    'Specifies whether to fail with an error when hostname canonicalization fails.',
  ],
  [
    'CanonicalizeHostname',
    'Controls whether explicit hostname canonicalization is performed.',
  ],
  [
    'CanonicalizeMaxDots',
    'Specifies the maximum number of dot characters in a hostname before canonicalization is disabled.',
  ],
  [
    'CanonicalizePermittedCNAMEs',
    'Specifies rules to determine whether CNAMEs should be followed when canonicalizing hostnames.',
  ],
  [
    'ChallengeResponseAuthentication',
    'Specifies whether to use challenge-response authentication.',
  ],
  [
    'CheckHostIP',
    "If this flag is set to ``yes ,'' ssh(1) will additionally check the host IP address in the known_hosts file.",
  ],
  [
    'Cipher',
    'Specifies the cipher to use for encrypting the session in protocol version 1.',
  ],
  [
    'Ciphers',
    'Specifies the ciphers allowed for protocol version 2 in order of preference.',
  ],
  [
    'ClearAllForwardings',
    'Specifies that all local, remote, and dynamic port forwardings specified in the configuration files or on the command line be cleared.',
  ],
  ['Compression', 'Specifies whether to use compression.'],
  [
    'CompressionLevel',
    'Specifies the compression level to use if compression is enabled.',
  ],
  ['Configure tunnel', null],
  [
    'ConnectionAttempts',
    'Specifies the number of tries (one per second) to make before exiting.',
  ],
  [
    'ConnectTimeout',
    'Specifies the timeout (in seconds) used when connecting to the SSH server, instead of using the default system TCP timeout.',
  ],
  [
    'ControlMaster',
    'Enables the sharing of multiple sessions over a single network connection.',
  ],
  [
    'ControlPath',
    "Specify the path to the control socket used for connection sharing as described in the ControlMaster section above or the string ``none'' to disable connection sharing.",
  ],
  [
    'ControlPersist',
    'When used in conjunction with ControlMaster , specifies that the master connection should remain open in the background (waiting for future client connections) after the initial client connection has been closed.',
  ],
  [
    'DynamicForward',
    'Specifies that a TCP port on the local machine be forwarded over the secure channel, and the application protocol is then used to determine where to connect to from the remote machine.',
  ],
  [
    'EnableSSHKeysign',
    "Setting this option to ``yes'' in the global client configuration file /etc/ssh/ssh_config enables the use of the helper program ssh-keysign(8) during HostbasedAuthentication .",
  ],
  ['EscapeChar', "Sets the escape character (default: `~ ) .'"],
  [
    'ExitOnForwardFailure',
    'Specifies whether ssh(1) should terminate the connection if it cannot set up all requested dynamic, tunnel, local, and remote port forwardings.',
  ],
  [
    'FingerprintHash',
    'Specifies the hash algorithm used when displaying key fingerprints.',
  ],
  [
    'ForwardAgent',
    'Specifies whether the connection to the authentication agent (if any) will be forwarded to the remote machine.',
  ],
  [
    'ForwardX11',
    'Specifies whether X11 connections will be automatically redirected over the secure channel and DISPLAY set.',
  ],
  [
    'ForwardX11Timeout',
    'Specify a timeout for untrusted X11 forwarding using the format described in the TIME FORMATS section of sshd_config(5).',
  ],
  [
    'ForwardX11Trusted',
    "If this option is set to ``yes ,'' remote X11 clients will have full access to the original X11 display.",
  ],
  [
    'GatewayPorts',
    'Specifies whether remote hosts are allowed to connect to local forwarded ports.',
  ],
  [
    'GlobalKnownHostsFile',
    'Specifies one or more files to use for the global host key database, separated by whitespace.',
  ],
  [
    'GSSAPIAuthentication',
    'Specifies whether user authentication based on GSSAPI is allowed.',
  ],
  ['GSSAPIClientIdentity', null],
  [
    'GSSAPIDelegateCredentials',
    'Forward (delegate) credentials to the server.',
  ],
  ['GSSAPIKeyExchange', null],
  ['GSSAPIRenewalForcesRekey', null],
  ['GSSAPIServerIdentity', null],
  ['GSSAPITrustDns', null],
  [
    'HashKnownHosts',
    'Indicates that ssh(1) should hash host names and addresses when they are added to ~/.ssh/known_hosts .',
  ],
  [
    'Host',
    'Restricts the following declarations (up to the next Host or Match keyword) to be only for those hosts that match one of the patterns given after the keyword.',
  ],
  [
    'HostbasedAuthentication',
    'Specifies whether to try rhosts based authentication with public key authentication.',
  ],
  [
    'HostbasedKeyTypes',
    'Specifies the key types that will be used for hostbased authentication as a comma-separated pattern list.',
  ],
  [
    'HostKeyAlgorithms',
    'Specifies the protocol version 2 host key algorithms that the client wants to use in order of preference.',
  ],
  [
    'HostKeyAlias',
    'Specifies an alias that should be used instead of the real host name when looking up or saving the host key in the host key database files.',
  ],
  ['HostName', 'Specifies the real host name to log into.'],
  [
    'IdentitiesOnly',
    'Specifies that ssh(1) should only use the authentication identity files configured in the ssh_config files, even if ssh-agent(1) or a PKCS11Provider offers more identities.',
  ],
  [
    'IdentityFile',
    "Specifies a file from which the user's DSA, ECDSA, Ed25519 or RSA authentication identity is read.",
  ],
  [
    'IgnoreUnknown',
    'Specifies a pattern-list of unknown options to be ignored if they are encountered in configuration parsing.',
  ],
  [
    'IPQoS',
    'Specifies the IPv4 type-of-service or DSCP class for connections.',
  ],
  [
    'KbdInteractiveAuthentication',
    'Specifies whether to use keyboard-interactive authentication.',
  ],
  [
    'KbdInteractiveDevices',
    'Specifies the list of methods to use in keyboard-interactive authentication.',
  ],
  ['KexAlgorithms', 'Specifies the available KEX (Key Exchange) algorithms.'],
  ['KeychainIntegration', null],
  [
    'LocalCommand',
    'Specifies a command to execute on the local machine after successfully connecting to the server.',
  ],
  [
    'LocalForward',
    'Specifies that a TCP port on the local machine be forwarded over the secure channel to the specified host and port from the remote machine.',
  ],
  [
    'LogLevel',
    'Gives the verbosity level that is used when logging messages from ssh(1).',
  ],
  [
    'MACs',
    'Specifies the MAC (message authentication code) algorithms in order of preference.',
  ],
  [
    'Match',
    'Restricts the following declarations (up to the next Host or Match keyword) to be used only when the conditions following the Match keyword are satisfied.',
  ],
  [
    'NoHostAuthenticationForLocalhost',
    'This option can be used if the home directory is shared across machines.',
  ],
  [
    'NumberOfPasswordPrompts',
    'Specifies the number of password prompts before giving up.',
  ],
  [
    'PasswordAuthentication',
    'Specifies whether to use password authentication.',
  ],
  [
    'PermitLocalCommand',
    'Allow local command execution via the LocalCommand option or using the ! command escape sequence in ssh(1).',
  ],
  ['PKCS11Provider', 'Specifies which PKCS#11 provider to use.'],
  ['Port', 'Specifies the port number to connect on the remote host.'],
  [
    'PreferredAuthentications',
    'Specifies the order in which the client should try protocol 2 authentication methods.',
  ],
  [
    'Protocol',
    'Specifies the protocol versions ssh(1) should support in order of preference.',
  ],
  ['ProxyCommand', 'Specifies the command to use to connect to the server.'],
  ['ProxyJump', 'Specifies one or more jump proxies as [user@]host[:port].'],
  [
    'ProxyUseFdpass',
    'Specifies that ProxyCommand will pass a connected file descriptor back to ssh(1) instead of continuing to execute and pass data.',
  ],
  [
    'PubkeyAuthentication',
    'Specifies whether to try public key authentication.',
  ],
  [
    'RekeyLimit',
    'Specifies the maximum amount of data that may be transmitted before the session key is renegotiated, optionally followed a maximum amount of time that may pass before the session key is renegotiated.',
  ],
  [
    'RemoteCommand',
    'Specifies a command to execute on the remote machine after successfully connecting to the server.',
  ],
  [
    'RemoteForward',
    'Specifies that a TCP port on the remote machine be forwarded over the secure channel to the specified host and port from the local machine.',
  ],
  ['RequestTTY', 'Specifies whether to request a pseudo-tty for the session.'],
  ['RevokedHostKeys', 'Specifies revoked host public keys.'],
  [
    'RhostsRSAAuthentication',
    'Specifies whether to try rhosts based authentication with RSA host authentication.',
  ],
  ['RSAAuthentication', 'Specifies whether to try RSA authentication.'],
  [
    'SendEnv',
    'Specifies what variables from the local environ(7) should be sent to the server.',
  ],
  [
    'ServerAliveCountMax',
    'Sets the number of server alive messages (see below) which may be sent without ssh(1) receiving any messages back from the server.',
  ],
  [
    'ServerAliveInterval',
    'Sets a timeout interval in seconds after which if no data has been received from the server, ssh(1) will send a message through the encrypted channel to request a response from the server.',
  ],
  [
    'StreamLocalBindMask',
    'Sets the octal file creation mode mask (umask) used when creating a Unix-domain socket file for local or remote port forwarding.',
  ],
  [
    'StreamLocalBindUnlink',
    'Specifies whether to remove an existing Unix-domain socket file for local or remote port forwarding before creating a new one.',
  ],
  [
    'StrictHostKeyChecking',
    "If this flag is set to ``yes ,'' ssh(1) will never automatically add host keys to the ~/.ssh/known_hosts file, and refuses to connect to hosts whose host key has changed.",
  ],
  [
    'TCPKeepAlive',
    'Specifies whether the system should send TCP keepalive messages to the other side.',
  ],
  [
    'Tunnel',
    'Request tun(4) device forwarding between the client and the server.',
  ],
  [
    'TunnelDevice',
    'Specifies the tun(4) devices to open on the client (local_tun) and the server (remote_tun .)',
  ],
  [
    'UpdateHostKeys',
    'Specifies whether ssh(1) should accept notifications of additional hostkeys from the server sent after authentication has completed and add them to UserKnownHostsFile .',
  ],
  [
    'UsePrivilegedPort',
    'Specifies whether to use a privileged port for outgoing connections.',
  ],
  ['User', 'Specifies the user to log in as.'],
  [
    'UserKnownHostsFile',
    'Specifies one or more files to use for the user host key database, separated by whitespace.',
  ],
  [
    'VerifyHostKeyDNS',
    'Specifies whether to verify the remote key using DNS and SSHFP resource records.',
  ],
  [
    'VisualHostKey',
    "If this flag is set to ``yes ,'' an ASCII art representation of the remote host key fingerprint is printed in addition to the fingerprint string at login and for unknown host keys.",
  ],
  ['XAuthLocation', 'Specifies the full pathname of the xauth(1) program.'],
];
