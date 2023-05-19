import {
  ContractError,
  ContractInteraction,
  HandlerResult
} from 'warp-contracts'

export type OwnableState = {
  owner?: string
}

export const ERROR_ONLY_OWNER =
  'This function is only available to the contract owner'

export const OnlyOwner = <S extends OwnableState>(
  _target: Object,
  _propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<
    (state: S, action: ContractInteraction<any>) => HandlerResult<S, any>
  >
) => {
  if (descriptor.value) {
    const originalMethod = descriptor.value
    const wrapper = (
      state: S,
      action: ContractInteraction<any>
    ) => {
      if (action.caller !== state.owner) {
        throw new ContractError(ERROR_ONLY_OWNER)
      } else {
        return originalMethod.apply(_target, [state, action])
      }
    }
    descriptor.value = wrapper
  }

  return descriptor
}
