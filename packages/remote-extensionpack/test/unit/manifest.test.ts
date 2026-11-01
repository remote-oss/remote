import {deepStrictEqual, strictEqual} from 'node:assert';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

/** The editor floor every family manifest carries: the constant of tools/editor-floor.ts, which the layout check verifies. */
const EDITOR_ENGINE =
  /EDITOR_ENGINE = '([^']+)'/.exec(
    readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        '..',
        'tools',
        'editor-floor.ts',
      ),
      'utf8',
    ),
  )?.[1] ?? '';

/** The package folder these rows read. */
const PACKAGE_FOLDER = path.join(import.meta.dirname, '..', '..');

/** BR-4's English sentence for the first release, which lists Dev Containers and Remote - SSH. */
const ENGLISH_DESCRIPTION =
  'An extension pack from the remote-oss project that installs the Dev Containers and Remote - SSH extensions together.';

/** The 14 language bundles, each with the display name of F-9001 3.3's first table. */
const DISPLAY_NAMES = new Map<string, string>([
  ['cs', 'Vzdálený vývoj'],
  ['de', 'Remoteentwicklung'],
  ['es', 'Desarrollo remoto'],
  ['fr', 'Développement à distance'],
  ['it', 'Sviluppo remoto'],
  ['ja', 'リモート開発'],
  ['ko', '원격 개발'],
  ['pl', 'Programowanie zdalne'],
  ['pt-br', 'Desenvolvimento Remoto'],
  ['qps-ploc', 'Rëmøtë Ðëvëløpmëñt'],
  ['ru', 'Удаленная разработка'],
  ['tr', 'Uzak Geliştirme'],
  ['zh-cn', '远程开发'],
  ['zh-tw', '遠端開發'],
]);

/** The reference's description of each language, F-9001 3.3's second table; the pack's own must differ from them. */
const REFERENCE_DESCRIPTIONS = new Map<string, string>([
  [
    'cs',
    'Sada rozšíření, která umožňuje otevřít libovolnou složku v kontejneru, na vzdáleném počítači nebo ve WSL a využívat úplnou sadu funkcí VS Code',
  ],
  [
    'de',
    'Ein Erweiterungspaket, mit dem Sie einen beliebigen Ordner in einem Container, auf einem Remotecomputer oder in WSL öffnen und den vollständigen Featuresatz VS Code nutzen können.',
  ],
  [
    'es',
    'Paquete de extensiones que permite abrir cualquier carpeta en un contenedor, en un equipo remoto o en WSL y aprovechar el conjunto de características completo de VS Code.',
  ],
  [
    'fr',
    'Un pack d’extensions qui vous permet d’ouvrir n’importe quel dossier dans un conteneur, sur un ordinateur distant ou dans WSL et de tirer parti de l’ensemble complet de fonctionnalités de VS Code.',
  ],
  [
    'it',
    'Un pacchetto di estensioni che consente di aprire qualsiasi cartella in un contenitore, in un computer remoto o in WSL e sfruttare i vantaggi del set di funzionalità completo di VS Code.',
  ],
  [
    'ja',
    'コンテナー、リモート マシン、または WSL の中で任意のフォルダーを開くことを可能にし、VS Code の完全な機能セットを利用できるにする拡張機能パック。',
  ],
  [
    'ko',
    '컨테이너, 원격 머신 또는 WSL에서 폴더를 열고 VS Code 전체 기능 집합을 활용할 수 있는 확장 팩입니다.',
  ],
  [
    'pl',
    'Pakiet rozszerzeń, który umożliwia otwieranie dowolnego folderu w kontenerze, na maszynie zdalnej lub w języku WSL i korzystanie z pełnego zestawu funkcji programu VS Code.',
  ],
  [
    'pt-br',
    'Um pacote de extensão que permite abrir qualquer pasta em um contêiner, em um computador remoto ou em WSL e aproveitar o conjunto completo de recursos do VS Code.',
  ],
  [
    'qps-ploc',
    "Æñ ëxtëñsïøñ pæçk thæt lëts ÿøµ øpëñ æñÿ følðër ïñ æ çøñtæïñër, øñ æ rëmøtë mæçhïñë, ør ïñ W§£ æñð tækë æðvæñtægë øf V§ Çøðë's fµll fëætµrë sët.",
  ],
  [
    'ru',
    'Пакет расширений, который позволяет открывать все папки в контейнере, на удаленном компьютере или в WSL и использовать полный набор функций VS Code.',
  ],
  [
    'tr',
    "Bir kapsayıcıdaki, uzak bir makinedeki veya WSL'deki herhangi bir klasörü açmanıza ve VS Code'un tüm özellik setinden yararlanmanıza olanak tanıyan bir uzantı paketi.",
  ],
  [
    'zh-cn',
    '一个扩展包，可用于打开容器内、远程计算机上或 WSL 中的任何文件夹，并利用 VS Code 的完整功能集。',
  ],
]);

/** The reference's eight keywords, which the pack's list must not equal. */
const REFERENCE_KEYWORDS = [
  'remote',
  'containers',
  'docker',
  'wsl',
  'ssh',
  'remote development',
  'dev container',
  'development container',
];

/** A Microsoft-owned address in any file of the package, as the layout rows spell it. */
const MICROSOFT_ADDRESS =
  /microsoft\.com|aka\.ms|visualstudio\.com|Microsoft\/vscode/i;

/** The hosts F-9002 BR-12 calls Microsoft-owned; a host is one of them or a subdomain of one. */
const MICROSOFT_HOSTS = [
  'microsoft.com',
  'visualstudio.com',
  'vsassets.io',
  'aka.ms',
  'microsoft.github.io',
  'vscode.dev',
  'code.visualstudio.com',
];

/** The manifest of the package as an object. */
interface Manifest {
  [field: string]: unknown;
  name: string;
  publisher: string;
  version: string;
  displayName: string;
  description: string;
  license: string;
  categories: string[];
  keywords: string[];
  extensionKind: string[];
  extensionPack: string[];
  engines: {vscode: string};
  repository: {type: string; url: string; directory: string};
  bugs: {url: string};
}

function textOf(file: string): string {
  return readFileSync(path.join(PACKAGE_FOLDER, file), 'utf8');
}

function manifestOf(): Manifest {
  return JSON.parse(textOf('package.json')) as Manifest;
}

function tableOf(language?: string): {
  displayName: string;
  description: string;
} {
  return JSON.parse(
    textOf(
      language === undefined
        ? 'package.nls.json'
        : `package.nls.${language}.json`,
    ),
  ) as {displayName: string; description: string};
}

/** The package's own files that are not code: the manifest, the string tables, the readme and the licence. */
function packageFiles(): string[] {
  return readdirSync(PACKAGE_FOLDER).filter(
    file => !['test', 'node_modules', '.tsc'].includes(file),
  );
}

/** Whether `address` is Microsoft-owned as BR-12 defines it: a host of the list or a subdomain, or a `microsoft` GitHub path. */
function isMicrosoftOwned(address: string): boolean {
  const parsed = new URL(address);
  const host = parsed.hostname.toLowerCase();
  return (
    MICROSOFT_HOSTS.some(
      owned => host === owned || host.endsWith(`.${owned}`),
    ) ||
    (host === 'github.com' &&
      (parsed.pathname.split('/')[1] ?? '').toLowerCase() === 'microsoft')
  );
}

/** The readme's text. */
function readme(): string {
  return textOf('README.md');
}

/** `text` with every run of white space as one space, so a sentence the readme wraps can be searched for. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** The text of the readme's section headed `heading`, down to the next section. */
function sectionOf(heading: string): string {
  const text = readme();
  const start = text.indexOf(`## ${heading}\n`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The target of every link and every image of the readme, as written. */
function linkTargets(): string[] {
  return [...readme().matchAll(/\]\(([^)\s]+)\)/g)].map(
    match => match[1] ?? '',
  );
}

describe('the pack’s package (card pack-01)', () => {
  it('F-9001 AC-1, F-9901 AC-18: the display name and description are placeholders that resolve to Remote Development and the project’s sentence', () => {
    deepStrictEqual(
      [manifestOf().displayName, manifestOf().description, tableOf()],
      [
        '%displayName%',
        '%description%',
        {displayName: 'Remote Development', description: ENGLISH_DESCRIPTION},
      ],
    );
  });

  it('F-9001 AC-2, F-9101 AC-2: the categories are Other then Extension Packs, and the pack declares no command, setting, view or activation event', () => {
    const manifest = manifestOf();
    deepStrictEqual(
      [
        manifest.categories,
        ['contributes', 'activationEvents'].filter(field => field in manifest),
      ],
      [['Other', 'Extension Packs'], []],
    );
  });

  it('F-9001 AC-3, F-9901 AC-16: the keywords are the project’s, with remote development and one for each member, and are not the reference’s eight', () => {
    const {keywords} = manifestOf();
    deepStrictEqual(
      [
        ['remote development', 'dev containers', 'ssh'].every(keyword =>
          keywords.includes(keyword),
        ),
        keywords.length <= 30,
        JSON.stringify([...keywords].sort()) ===
          JSON.stringify([...REFERENCE_KEYWORDS].sort()),
      ],
      [true, true, false],
    );
  });

  it('F-9001 AC-4, F-9901 AC-10 (ruling-d56-english): the package holds package.nls.json and the 14 bundles and no l10n folder, with the reference’s display names, and in every bundle the English description, which is not the reference’s', () => {
    const bundles = packageFiles()
      .filter(file => /^package\.nls\..+\.json$/.test(file))
      .map(file => file.slice('package.nls.'.length, -'.json'.length))
      .filter(name => name !== '')
      .sort();
    deepStrictEqual(
      {
        files: [
          existsSync(path.join(PACKAGE_FOLDER, 'package.nls.json')),
          bundles,
          existsSync(path.join(PACKAGE_FOLDER, 'l10n')),
        ],
        names: [...DISPLAY_NAMES.keys()].map(
          language => tableOf(language).displayName,
        ),
        descriptions: [...DISPLAY_NAMES.keys()].map(language => {
          const {description} = tableOf(language);
          return (
            description === ENGLISH_DESCRIPTION &&
            description !== REFERENCE_DESCRIPTIONS.get(language)
          );
        }),
      },
      {
        files: [true, [...DISPLAY_NAMES.keys()].sort(), false],
        names: [...DISPLAY_NAMES.values()],
        descriptions: [...DISPLAY_NAMES.keys()].map(() => true),
      },
    );
  });

  it('F-9001 AC-5: the engine floor is the root constant the layout check verifies', () => {
    strictEqual(manifestOf().engines.vscode, EDITOR_ENGINE);
  });

  it('F-9001 AC-6, F-9901 AC-15 (ruling-d56): the repository and bugs are the monorepo’s, as the members’ are, and no address in the manifest or the bundles is Microsoft’s', () => {
    const manifest = manifestOf();
    deepStrictEqual(
      [
        manifest.repository,
        manifest.bugs,
        packageFiles()
          .filter(file => /^package(\.nls.*)?\.json$/.test(file))
          .filter(file => MICROSOFT_ADDRESS.test(textOf(file))),
      ],
      [
        {
          type: 'git',
          url: 'https://github.com/remote-oss/remote.git',
          directory: 'packages/remote-extensionpack',
        },
        {url: 'https://github.com/remote-oss/remote/issues'},
        [],
      ],
    );
  });

  it('F-9001 AC-23, F-9101 AC-1, F-9901 AC-2: the pack lists exactly Dev Containers and Remote - SSH, in that order, and its description names exactly those two', () => {
    const manifest = manifestOf();
    deepStrictEqual(
      [
        manifest.extensionPack,
        ENGLISH_DESCRIPTION.includes(
          'Dev Containers and Remote - SSH extensions',
        ),
        tableOf().description.includes('Remote Explorer'),
      ],
      [['remote-oss.remote-containers', 'remote-oss.remote-ssh'], true, false],
    );
  });

  it('F-9901 AC-4: the categories and extension kind are the reference’s, and the pack has no entry point, activation event or contribution', () => {
    const manifest = manifestOf();
    deepStrictEqual(
      [
        manifest.categories,
        manifest.extensionKind,
        ['main', 'browser', 'activationEvents', 'contributes'].filter(
          field => field in manifest,
        ),
      ],
      [['Other', 'Extension Packs'], ['ui'], []],
    );
  });

  it('F-9901 AC-14: the package ships exactly the manifest, the string tables, the readme and the licence', () => {
    deepStrictEqual(
      [
        textOf('.vscodeignore')
          .split('\n')
          .filter(line => line !== ''),
        textOf('LICENSE').includes('MIT License'),
        textOf('LICENSE').includes('remote-oss contributors'),
        ['LICENSE.txt', 'ThirdPartyNotices.txt'].filter(file =>
          existsSync(path.join(PACKAGE_FOLDER, file)),
        ),
      ],
      [
        ['**', '!package.json', '!package.nls*.json', '!README.md', '!LICENSE'],
        true,
        true,
        [],
      ],
    );
  });

  it('F-9002 AC-1, AC-17: the package root holds the readme and no changelog, and the manifest has no markdown or pricing field', () => {
    const manifest = manifestOf();
    deepStrictEqual(
      [
        existsSync(path.join(PACKAGE_FOLDER, 'README.md')),
        existsSync(path.join(PACKAGE_FOLDER, 'CHANGELOG.md')),
        'markdown' in manifest,
        'pricing' in manifest,
      ],
      [true, false, false, false],
    );
  });

  it('F-9002 AC-6, AC-7 (ruling-d56-affiliation): the title names Remote Development and remote-oss, not Visual Studio Code or Microsoft, the introduction names only a container and a remote machine over SSH, and the readme says that a pack that lists another publisher’s extension ids installs those, not the family’s', () => {
    const [title = ''] = readme().split('\n');
    const introduction = readme().split('\n## ')[0] ?? '';
    deepStrictEqual(
      [
        title.includes('Remote Development') && title.includes('remote-oss'),
        /Visual Studio Code|Microsoft/.test(title),
        introduction.includes('container') && introduction.includes('SSH'),
        /WSL|tunnel/i.test(introduction),
        flat(introduction).includes(
          "A pack installs the extensions it lists by id, so a pack that lists another publisher's extension ids installs those, not this family's.",
        ),
      ],
      [true, false, true, false, true],
    );
  });

  it('F-9002 AC-8, AC-23: the member list has exactly Dev Containers and Remote - SSH, each linking to its folder with a line of purpose, and WSL and Remote - Tunnels are named only as not part of this release', () => {
    const members = sectionOf('The members');
    const items = members
      .split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => /^- \[([^\]]+)\]\(([^)]+)\): \S/.exec(line)?.slice(1, 3));
    deepStrictEqual(
      [
        items,
        members.includes('WSL: not part of this release.'),
        members.includes('Remote - Tunnels: not part of this release.'),
        readme().split('\n## ')[0]?.includes('WSL') ?? true,
      ],
      [
        [
          [
            'Dev Containers',
            'https://github.com/remote-oss/remote/tree/main/packages/remote-containers#readme',
          ],
          [
            'Remote - SSH',
            'https://github.com/remote-oss/remote/tree/main/packages/remote-ssh#readme',
          ],
        ],
        true,
        true,
        false,
      ],
    );
  });

  it('F-9002 AC-9: the readme names Remote Explorer and Remote - SSH: Editing Configuration Files as arriving with the members, and says each member can be installed on its own', () => {
    const members = sectionOf('The members');
    deepStrictEqual(
      [
        members.includes('Remote Explorer'),
        members.includes('Remote - SSH: Editing Configuration Files'),
        flat(members).includes('arrive together with the members'),
        members.includes('Each member can also be installed on its own.'),
      ],
      [true, true, true, true],
    );
  });

  it('F-9002 AC-10: the requirements name the lowest editor version, the engine floor, and link each member’s readme', () => {
    const requirements = sectionOf('Requirements');
    deepStrictEqual(
      [
        requirements.includes(
          `version ${manifestOf().engines.vscode.replace('^', '')} or later`,
        ),
        requirements.includes('packages/remote-containers#readme'),
        requirements.includes('packages/remote-ssh#readme'),
      ],
      [true, true, true],
    );
  });

  it('F-9002 AC-11, F-9901 AC-7, AC-13: the installation says what the pack installs, that two packs are unsupported and the family stands down, that a missing member is skipped, and that uninstalling removes the members; the readme says there is no telemetry', () => {
    const installation = sectionOf('Installation');
    deepStrictEqual(
      [
        flat(installation).includes('Dev Containers and Remote - SSH'),
        flat(installation).includes(
          'Install one Remote Development pack, not two.',
        ),
        flat(installation).includes('unsupported'),
        flat(installation).includes(
          "this family's extensions stand down next to extensions with those identifiers",
        ),
        flat(installation).includes('installs without it and says nothing'),
        flat(installation).includes('uninstalls the members it installed'),
        sectionOf('Telemetry').includes(
          'Neither this pack nor its members collect or send telemetry.',
        ),
        flat(readme()).includes(
          "so a pack that lists another publisher's extension ids installs those",
        ),
      ],
      [true, true, true, true, true, true, true, true],
    );
  });

  it('F-9002 AC-14, F-9901 AC-5: every link is an absolute https or mailto address, none is Microsoft’s or an editor scheme or a fragment, and the licence is MIT', () => {
    const targets = linkTargets();
    deepStrictEqual(
      [
        targets.length > 0,
        targets.filter(target => !/^(https:\/\/|mailto:)/.test(target)),
        targets
          .filter(target => target.startsWith('https:'))
          .filter(target => isMicrosoftOwned(target)),
        manifestOf().license,
      ],
      [true, [], [], 'MIT'],
    );
  });

  it('F-9002 AC-15: the readme has no image, so none is Microsoft-hosted or without an https address in a remote-oss repository', () => {
    deepStrictEqual(readme().match(/!\[[^\]]*\]\([^)]*\)|<img /g) ?? [], []);
  });

  it('F-9901 AC-8: the readme and the package present no release of the reference as the project’s own history', () => {
    deepStrictEqual(
      [readme(), textOf('package.json')].filter(text =>
        /\b0\.(1[4-9]|2[0-6])\.\d+\b/.test(text),
      ),
      [],
    );
  });

  it('F-9001 AC-15 (version): the version is a release number a gallery lists, and the engine floor is a caret range of the editor floor', () => {
    const manifest = manifestOf();
    deepStrictEqual(
      [
        /^\d+\.\d+\.\d+$/.test(String(manifest.version)),
        manifest.engines.vscode.startsWith('^'),
      ],
      [true, true],
    );
  });

  it('F-9002 AC-18 (license): the licence field is MIT and the package ships the licence text the gallery links', () => {
    deepStrictEqual(
      [
        manifestOf().license,
        textOf('LICENSE').includes('MIT License'),
        manifestOf().bugs.url,
      ],
      ['MIT', true, 'https://github.com/remote-oss/remote/issues'],
    );
  });

  it('F-9101 AC-11 (name, publisher): the pack’s id is remote-oss.vscode-remote-extensionpack', () => {
    const manifest = manifestOf();
    strictEqual(
      `${String(manifest.publisher)}.${manifest.name}`,
      'remote-oss.vscode-remote-extensionpack',
    );
  });

  it('F-9101 AC-29 (extensionPack): every entry is a publisher.name id of the family, and none is listed twice', () => {
    const entries = manifestOf().extensionPack;
    deepStrictEqual(
      [
        entries.every(entry => /^remote-oss\.[a-z0-9-]+$/.test(entry)),
        new Set(entries).size === entries.length,
      ],
      [true, true],
    );
  });

  it('F-9901 AC-3 (extensionPack): Remote - SSH brings Remote Explorer and the SSH configuration editor, and Dev Containers brings nothing, so the first release installs the pack plus four', () => {
    const packOf = (folder: string): string[] =>
      (
        JSON.parse(
          readFileSync(
            path.join(PACKAGE_FOLDER, '..', folder, 'package.json'),
            'utf8',
          ),
        ) as {extensionPack?: string[]}
      ).extensionPack ?? [];
    deepStrictEqual(
      [packOf('remote-containers'), [...packOf('remote-ssh')].sort()],
      [[], ['remote-oss.remote-explorer', 'remote-oss.remote-ssh-edit']],
    );
  });

  it('F-9901 AC-9 (publisher): the publisher is remote-oss', () => {
    strictEqual(manifestOf().publisher, 'remote-oss');
  });
});
