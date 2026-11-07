import {
  TOOLKIT_CONFIGURATION_METHOD,
  type ToolkitAuthority,
  type ConfigurationRequest
} from './toolkit-authority'

type Source = { mainFrame: object; getURL(): string }
export function createToolkitPanelContext(
  authority: ToolkitAuthority,
  source: Source,
  url: string,
  approve: (request: ConfigurationRequest) => Promise<boolean>
) {
  const frame = source.mainFrame
  const context = authority.openContext()
  return {
    revoke: (): void => authority.revoke(context),
    async call(event: { sender: object; senderFrame: object | null }, input: unknown) {
      if (
        event.sender !== source ||
        event.senderFrame !== frame ||
        source.mainFrame !== frame ||
        source.getURL() !== url
      ) {
        throw new Error('Unauthorized Toolkit source')
      }
      return authority.call(context, TOOLKIT_CONFIGURATION_METHOD, input, approve)
    }
  }
}
