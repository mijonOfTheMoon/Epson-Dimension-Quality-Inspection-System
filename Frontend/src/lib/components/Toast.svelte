<script lang="ts">
  let {
    text,
    tone = 'info',
  }: {
    text: string;
    tone?: 'info' | 'error' | 'success';
  } = $props();

  const palette = {
    info: 'bg-blue-600',
    error: 'bg-red-600',
    success: 'bg-green-600',
  } as const;
</script>

<div class="fixed top-4 right-4 z-50 {palette[tone]} text-white px-4 py-2.5 rounded-lg shadow-lg text-sm">
  {text}
</div>
