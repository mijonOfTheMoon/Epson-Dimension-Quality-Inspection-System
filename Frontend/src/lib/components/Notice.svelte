<script lang="ts">
  let {
    text,
    tone = 'error',
  }: {
    text: string;
    tone?: 'error' | 'info' | 'warning';
  } = $props();

  const palette = {
    error: 'bg-red-50 border-red-200 text-red-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
  } as const;
</script>

<div class="{palette[tone]} border rounded-xl p-3 text-sm">
  {text}
</div>
