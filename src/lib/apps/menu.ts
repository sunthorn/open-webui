/**
 * The axi rail, as data.
 *
 * Before this, the three federated apps were three hand-written blocks of
 * markup in Sidebar.svelte -- once for the collapsed rail and once for the
 * expanded panel, so every change had to be made twice and the two drifted.
 *
 * Each app owns a `root` menu and an `options` menu. Options is the app's own
 * configuration and always uses the sliders icon; the gear belongs to axi's
 * system Settings alone, reached from the user menu. See
 * docs/superpowers/plans/2026-08-24-axi-menu-consolidation.md
 *
 * salem and finny rows point at /x/<app>/<path>, an axi route that hosts the
 * app's page inside the axi shell. They are deliberately NOT external: an
 * external href navigates the whole browser away and the app then draws its
 * own sidebar, which is exactly what the rail exists to replace.
 *
 * `external: true` survives on the type for a destination that genuinely has
 * to leave axi. Nothing uses it today.
 */

export type MenuRow =
	| { kind: 'divider' }
	| { kind: 'label'; label: string }
	| {
			kind: 'link';
			id: string;
			label: string;
			href: string;
			icon: string;
			external?: boolean;
			/** opens this app's Options level instead of navigating */
			opensOptions?: boolean;
	  };

export type AppDef = {
	id: string;
	label: string;
	icon: string;
	/** where the rail icon itself points */
	href: string;
	external?: boolean;
	root: MenuRow[];
	options: MenuRow[];
};

/** Heroicons outline path data, inlined so the rail carries no import cost. */
export const ICON = {
	home: 'M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25',
	grid: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z',
	calendar:
		'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5',
	users: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
	phone:
		'M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z',
	chat: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155',
	doc: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
	mic: 'M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z',
	link: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
	spark:
		'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z',
	building:
		'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
	scroll:
		'M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z',
	chart:
		'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
	gauge: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
	shield:
		'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
	note: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
	/** three lines with knobs -- adjustments-horizontal. Options, never the gear. */
	sliders:
		'M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75',
	back: 'M15.75 19.5L8.25 12l7.5-7.5',
	chevron: 'M8.25 4.5l7.5 7.5-7.5 7.5'
} as const;

const optionsRow = (id: string): MenuRow => ({
	kind: 'link',
	id: `${id}-options`,
	label: 'Options',
	href: '',
	icon: ICON.sliders,
	opensOptions: true
});

export const APPS: AppDef[] = [
	{
		id: 'xplan',
		label: 'xPlan',
		icon: ICON.grid,
		href: '/apps/overview',
		root: [
			{ kind: 'link', id: 'xplan-home', label: 'Home', href: '/apps/overview', icon: ICON.home },
			{
				kind: 'link',
				id: 'xplan-briefing',
				label: 'Briefing',
				href: '/apps/briefing',
				icon: ICON.calendar
			},
			{
				kind: 'link',
				id: 'xplan-clients',
				// "Clients-Sync", not "Clients": finny's Documents panel has its own
				// Clients row, and the two are different things. This one is the
				// XPLAN-side client list the planner syncs from.
				label: 'Clients-Sync',
				href: '/apps/clients',
				icon: ICON.users
			},
			{
				kind: 'link',
				id: 'xplan-enquiry',
				label: 'New Enquiry',
				href: '/apps/enquiry',
				icon: ICON.phone
			},
			{
				kind: 'link',
				id: 'xplan-discovery',
				label: 'Discovery Meeting',
				href: '/apps/discovery',
				icon: ICON.chat
			},
			{
				kind: 'link',
				id: 'xplan-data-entry',
				label: 'Data Entry & Research',
				href: '/apps/data-entry',
				icon: ICON.doc
			},
			{ kind: 'divider' },
			optionsRow('xplan')
		],
		options: [
			{
				kind: 'link',
				id: 'xplan-access',
				label: 'XPLAN access',
				href: '/apps/settings',
				icon: ICON.shield
			}
		]
	},
	{
		id: 'salem',
		// Named for what it does, not for the product it came from.
		label: 'Meetings',
		icon: ICON.mic,
		href: '/x/salem/meetings',
		root: [
			{
				kind: 'link',
				id: 'salem-meetings',
				label: 'Meetings',
				href: '/x/salem/meetings',
				icon: ICON.mic
			},
				{
				kind: 'link',
				id: 'salem-notes',
				label: 'Notes',
				href: '/x/salem/notes',
				icon: ICON.note
			},
			{
				kind: 'link',
				id: 'salem-connections',
				label: 'Connections',
				href: '/x/salem/connectors',
				icon: ICON.link
			},
			{ kind: 'divider' },
			optionsRow('salem')
		],
		options: [
			// No "Meeting note templates" row yet. salem has the full CRUD API at
			// /api/templates and the meeting UI picks from it, but there is no page
			// to manage them — so the row pointed at /settings/templates, which is
			// not a route. salem's catch-all then rendered the chat shell, which is
			// why it looked like the menu was navigating to the wrong place.
			// It is the obvious first thing to build in this panel.
			{
				kind: 'link',
				id: 'salem-my-connections',
				label: 'Connected accounts',
				href: '/x/salem/settings/connections',
				icon: ICON.link
			},
			{ kind: 'label', label: 'Admin' },
			{
				kind: 'link',
				id: 'salem-admin-dashboard',
				label: 'Dashboard',
				href: '/x/salem/settings/admin/dashboard',
				icon: ICON.chart
			},
			{
				kind: 'link',
				id: 'salem-admin-usage',
				label: 'Usage',
				href: '/x/salem/settings/admin/usage',
				icon: ICON.gauge
			},
			{
				kind: 'link',
				id: 'salem-admin-logs',
				label: 'Logs',
				href: '/x/salem/settings/admin/logs',
				icon: ICON.scroll
			}
		]
	},
	{
		id: 'finny',
		label: 'Documents',
		// A document, not a person. The users glyph was left over from when this
		// tab was called finny and led with its client list.
		icon: ICON.doc,
		href: '/x/finny/',
		root: [
			{
				kind: 'link',
				id: 'finny-dashboard',
				label: 'Dashboard',
				href: '/x/finny/',
				icon: ICON.grid
			},
			{
				kind: 'link',
				id: 'finny-clients',
				label: 'Clients',
				href: '/x/finny/clients',
				icon: ICON.users
			},
			{
				kind: 'link',
				id: 'finny-templates',
				label: 'Templates',
				href: '/x/finny/templates',
				icon: ICON.spark
			},
			{
				kind: 'link',
				id: 'finny-documents',
				label: 'Documents',
				href: '/x/finny/documents',
				icon: ICON.doc
			},
			{
				kind: 'link',
				id: 'finny-teams',
				label: 'Teams',
				href: '/x/finny/teams',
				icon: ICON.users
			},
			{ kind: 'divider' },
			optionsRow('finny')
		],
		options: [
			{
				kind: 'link',
				id: 'finny-org',
				label: 'Organisation',
				href: '/x/finny/settings/organization',
				icon: ICON.building
			},
			{
				kind: 'link',
				id: 'finny-audit',
				label: 'Audit',
				href: '/x/finny/audit',
				icon: ICON.scroll
			}
		]
	}
];

export const appById = (id: string | null): AppDef | undefined =>
	APPS.find((a) => a.id === id);

/**
 * Which app owns a given path. Longest prefix wins so /apps/settings resolves
 * to xplan rather than falling through to axi.
 */
export const appForPath = (pathname: string): AppDef | undefined => {
	if (pathname.startsWith('/apps')) return appById('xplan');
	// /x/<app>/... is the host route: axi's shell with the app's page inside it
	const hosted = pathname.match(/^\/x\/([a-z]+)/);
	if (hosted) return appById(hosted[1]);
	if (pathname.startsWith('/salem')) return appById('salem');
	if (pathname.startsWith('/finny')) return appById('finny');
	return undefined;
};
