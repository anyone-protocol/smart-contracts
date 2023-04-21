import {
  ContractError,
  ContractInteraction,
  HandlerResult
} from 'warp-contracts'

export type OwnableState = {
  owner?: string
}

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
        throw new ContractError(
          'This function is only available to the contract owner'
        )
      } else {
        return originalMethod.apply(this, [state, action])
      }
    }
    descriptor.value = wrapper
  }

  return descriptor
}
