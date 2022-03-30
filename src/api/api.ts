import { SearchResult } from "../types"

export abstract class API<APIResult> {
  protected last_id = 0
  readonly has_show_more: boolean = false
  readonly abstract name: string
  readonly abstract tabs: string[]

  protected abstract fetchURL(tab: string, query: string): { url: string, options?: RequestInit }
  protected abstract processResult(result: APIResult, tab: string): SearchResult[]

  protected denormalizeTab(tab: string): string {
    return tab == "character" ? "characters" : tab
  }

  public async search(query: string, tab: string): Promise<SearchResult[]> {
    if (query.length < 3) {
      return []
    }
    const id = ++this.last_id
    const { url, options } = this.fetchURL(tab, query)
    const resp = await fetch(url, options)
    const data = await resp.json()
    if (this.last_id > id) return []
    const results = this.processResult(data, tab)
    return this.filterValidResults(results)
  }

  private async filterValidResults(results: SearchResult[]): Promise<SearchResult[]> {
    const valid_urls = new Set<string>()
    await Promise.all(results.map(async result => {
      try {
        const head = await fetch(result.image_url, {
          method: "HEAD"
        })
        if (head.status === 200) {
          valid_urls.add(result.image_url)
        }
      } catch (e) {
        console.warn(e)
      }
    }))
    return results.filter(result => valid_urls.has(result.image_url))
  }

  // eslint-disable-next-line
  public async showMore(tab: string, selected: SearchResult): Promise<SearchResult[]> {
    return []
  }
}