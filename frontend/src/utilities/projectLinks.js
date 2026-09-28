// HelpDeskPage.vue is hardcoded to Cherry Blossom Development (company_id 1),
// so only that company's default (Help Desk) project should link there --
// every other project, including other companies' default projects, uses the
// generic project page.
const HELP_DESK_COMPANY_ID = 1

export function getProjectHomepageLink(project) {
  if (project.is_default && project.company_id === HELP_DESK_COMPANY_ID) {
    return '/help-desk'
  }
  return `/project/${project.id}`
}
