//! Opens one of the project's GitHub pages in the default browser, only when the user clicks (F22 item 4: Report a
//! bug). The page sends a page name, never a URL: the URL is PROJECT_URL from src/ui/projectLinks.ts (compiled in,
//! so the address is written once) plus a fixed path. Nothing else can be opened.

/// src/ui/projectLinks.ts, whose `export const PROJECT_URL = '…';` line holds the project's address.
const PROJECT_LINKS: &str = include_str!("../../src/ui/projectLinks.ts");
const PROJECT_URL_LINE: &str = "export const PROJECT_URL = '";

/// The project's address, checked to be a GitHub https address with no quote or space in it.
fn project_url() -> Result<&'static str, String> {
    let start = PROJECT_LINKS.find(PROJECT_URL_LINE).ok_or("PROJECT_URL is missing from projectLinks.ts")? + PROJECT_URL_LINE.len();
    let length = PROJECT_LINKS[start..].find('\'').ok_or("PROJECT_URL is not closed")?;
    let url = &PROJECT_LINKS[start..start + length];
    let safe = url.starts_with("https://github.com/") && !url.contains(|c: char| c.is_whitespace() || c == '"' || c == '\'');
    if safe { Ok(url) } else { Err(format!("PROJECT_URL is not a GitHub address: {url}")) }
}

/// The address of `page`: only the bug-report issue form.
fn page_url(page: &str) -> Result<String, String> {
    let path = match page {
        "issues" => "/issues/new?template=bug.yml",
        _ => return Err(format!("unknown project page: {page}")),
    };
    Ok(format!("{}{path}", project_url()?))
}

#[tauri::command]
pub fn open_project_page(page: String) -> Result<(), String> {
    open_in_browser(&page_url(&page)?)
}

/// Hands the address to Windows' URL handler (the default browser); no shell parses it.
#[cfg(windows)]
fn open_in_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(not(windows))]
fn open_in_browser(_url: &str) -> Result<(), String> {
    Err("Opening the browser is only supported on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_issues_page_is_project_url_plus_the_bug_template() {
        let url = page_url("issues").unwrap();
        assert!(url.starts_with("https://github.com/"), "{url}");
        assert_eq!(url, format!("{}/issues/new?template=bug.yml", project_url().unwrap()));
    }

    #[test]
    fn any_other_page_or_a_url_is_refused() {
        assert!(page_url("https://example.com").is_err());
        assert!(page_url("releases").is_err());
        assert!(open_project_page("file:///C:/Windows/notepad.exe".into()).is_err());
    }
}
