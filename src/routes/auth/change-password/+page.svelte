<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import { updateUserPassword, userSignOut } from '$lib/apis/auths';
	import { WEBUI_BASE_URL } from '$lib/constants';
	import { WEBUI_NAME, user } from '$lib/stores';
	import { safeRedirect } from '$lib/utils/passwordChange';

	import Spinner from '$lib/components/common/Spinner.svelte';
	import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';

	const i18n = getContext('i18n');

	let loaded = false;
	let loading = false;

	let currentPassword = '';
	let newPassword = '';
	let confirmPassword = '';

	$: redirectTarget = safeRedirect($page.url.searchParams.get('redirect'));

	const submitHandler = async () => {
		if (newPassword !== confirmPassword) {
			toast.error($i18n.t('Passwords do not match.'));
			return;
		}
		if (newPassword === currentPassword) {
			toast.error($i18n.t('The new password must be different from the current password.'));
			return;
		}

		loading = true;
		const res = await updateUserPassword(localStorage.token, currentPassword, newPassword).catch(
			(error) => {
				toast.error(`${error}`);
				return null;
			}
		);
		loading = false;

		if (res) {
			toast.success($i18n.t('Successfully updated.'));
			if ($user) {
				user.set({ ...$user, must_change_password: false });
			}
			// Full load so the app re-fetches everything the 403s blocked.
			window.location.href = redirectTarget;
		}
	};

	const signOutHandler = async () => {
		const res = await userSignOut().catch(() => null);
		user.set(null);
		localStorage.removeItem('token');
		location.href = res?.redirect_url ?? '/auth';
	};

	onMount(() => {
		if (!localStorage.token) {
			goto('/auth');
			return;
		}
		if ($user && !$user.must_change_password) {
			goto(redirectTarget);
			return;
		}
		loaded = true;
	});
</script>

<svelte:head>
	<title>
		{`${$i18n.t('Choose a new password')} • ${$WEBUI_NAME}`}
	</title>
</svelte:head>

<div class="w-full h-screen max-h-[100dvh] text-white relative" id="auth-page">
	<div class="w-full h-full absolute top-0 left-0 bg-white dark:bg-black"></div>

	<div class="w-full absolute top-0 left-0 right-0 h-8 drag-region"></div>

	{#if loaded}
		<div
			class="fixed bg-transparent min-h-screen w-full flex justify-center font-primary z-50 text-black dark:text-white"
			id="auth-container"
		>
			<div class="w-full px-10 min-h-screen flex flex-col text-center">
				<div class="my-auto flex flex-col justify-center items-center">
					<div class=" sm:max-w-md my-auto pb-10 w-full dark:text-gray-100">
						<form
							class=" flex flex-col justify-center"
							on:submit={(e) => {
								e.preventDefault();
								submitHandler();
							}}
						>
							<div class="mb-1">
								<div class=" text-2xl font-medium">
									{$i18n.t('Choose a new password')}
								</div>
								<div class="mt-1 text-xs font-medium text-gray-600 dark:text-gray-500">
									{$i18n.t(
										'Your account was set up with a temporary password. Choose your own to continue.'
									)}
								</div>
							</div>

							<div class="flex flex-col mt-4 text-left">
								<div class="mb-2">
									<label for="current-password" class="text-sm font-medium mb-1 block"
										>{$i18n.t('Current Password')}</label
									>
									<SensitiveInput
										bind:value={currentPassword}
										type="password"
										id="current-password"
										inputClassName="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
										placeholder={$i18n.t('Enter your current password')}
										autocomplete="current-password"
										name="current-password"
										required
									/>
								</div>

								<div class="mb-2">
									<label for="new-password" class="text-sm font-medium mb-1 block"
										>{$i18n.t('New Password')}</label
									>
									<SensitiveInput
										bind:value={newPassword}
										type="password"
										id="new-password"
										inputClassName="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
										placeholder={$i18n.t('Enter your new password')}
										autocomplete="new-password"
										name="new-password"
										required
									/>
								</div>

								<div>
									<label for="confirm-password" class="text-sm font-medium mb-1 block"
										>{$i18n.t('Confirm Password')}</label
									>
									<SensitiveInput
										bind:value={confirmPassword}
										type="password"
										id="confirm-password"
										inputClassName="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
										placeholder={$i18n.t('Confirm your new password')}
										autocomplete="new-password"
										name="confirm-password"
										required
									/>
								</div>
							</div>

							<div class="mt-5">
								<button
									class="flex justify-center items-center gap-2 bg-gray-700/5 hover:bg-gray-700/10 dark:bg-gray-100/5 dark:hover:bg-gray-100/10 dark:text-gray-300 dark:hover:text-white transition w-full rounded-full font-medium text-sm py-2.5 {loading
										? 'cursor-not-allowed'
										: ''}"
									type="submit"
									disabled={loading}
								>
									{$i18n.t('Update password')}
									{#if loading}
										<Spinner className="size-4" />
									{/if}
								</button>

								<div class=" mt-4 text-sm text-center">
									<button class=" font-medium underline" type="button" on:click={signOutHandler}>
										{$i18n.t('Sign Out')}
									</button>
								</div>
							</div>
						</form>
					</div>
				</div>
			</div>
		</div>

		<div class="fixed m-10 z-50">
			<div class="flex space-x-2">
				<div class=" self-center">
					<img
						crossorigin="anonymous"
						src="{WEBUI_BASE_URL}/static/favicon.png"
						class=" w-6 rounded-full"
						alt=""
					/>
				</div>
			</div>
		</div>
	{/if}
</div>
