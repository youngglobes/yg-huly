<script lang="ts">
  export let rows: Array<{
    id: string
    identifier: string
    title: string
    project: string
    hours: number
    submittedOn: number
    employee: string
  }>
  export let employeeNames: Map<string, string>
  export let projectName: (id: string) => string
</script>

<div />
