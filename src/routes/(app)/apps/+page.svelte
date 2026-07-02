<script lang="ts">
	// /apps has no landing page of its own — send the planner to Overview.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		goto('/apps/overview', { replaceState: true });
	});
</script>
