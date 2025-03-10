import type {
  Extender,
  Obj,
  Stores,
  FormConfig,
  TransformFunction,
  ExtenderHandler,
  FormControl,
  AddValidatorFn,
  Helpers,
  Form,
} from '@felte/common';
import {
  isFormControl,
  shouldIgnore,
  isInputElement,
  isSelectElement,
  isElement,
  getInputTextOrNumber,
  _get,
  _set,
  _unset,
  _merge,
  _cloneDeep,
  _defaultsDeep,
  getPath,
  getFormDefaultValues,
  getFormControls,
  _isPlainObject,
  debounce,
} from '@felte/common';
import { get } from './get';

export type FormActionConfig<Data extends Obj> = {
  stores: Stores<Data>;
  config: FormConfig<Data>;
  extender: Extender<Data>[];
  helpers: Helpers<Data, string> & {
    addValidator: AddValidatorFn<Data>;
    addTransformer(transformer: TransformFunction<Data>): void;
  };
  createSubmitHandler: Form<Data>['createSubmitHandler'];
  handleSubmit: Form<Data>['handleSubmit'];
  _setFormNode(node: HTMLFormElement): void;
  _getInitialValues(): Data;
  _setCurrentExtenders(extenders: ExtenderHandler<Data>[]): void;
  _getCurrentExtenders(): ExtenderHandler<Data>[];
};

export function createFormAction<Data extends Obj>({
  helpers,
  stores,
  config,
  extender,
  createSubmitHandler,
  handleSubmit,
  _setFormNode,
  _getInitialValues,
  _setCurrentExtenders,
  _getCurrentExtenders,
}: FormActionConfig<Data>) {
  const { setFields, setTouched, reset, setInitialValues } = helpers;
  const { addValidator, addTransformer, validate } = helpers;
  const {
    data,
    errors,
    warnings,
    touched,
    isSubmitting,
    isDirty,
    interacted,
    isValid,
    isValidating,
  } = stores;

  function form(node: HTMLFormElement) {
    if (!node.requestSubmit)
      node.requestSubmit = handleSubmit as typeof node.requestSubmit;
    function callExtender(stage: 'MOUNT' | 'UPDATE') {
      return function (extender: Extender<Data>) {
        return extender({
          form: node,
          stage,
          controls: Array.from(node.elements).filter(isFormControl),
          data,
          errors,
          warnings,
          touched,
          isValid,
          isValidating,
          isSubmitting,
          isDirty,
          interacted,
          config,
          addValidator,
          addTransformer,
          setFields,
          validate,
          reset,
          createSubmitHandler,
          handleSubmit,
        });
      };
    }

    _setCurrentExtenders(extender.map(callExtender('MOUNT')));
    node.noValidate = !!config.validate;
    const { defaultData, defaultTouched } = getFormDefaultValues<Data>(node);
    _setFormNode(node);
    setInitialValues(_merge(_cloneDeep(defaultData), _getInitialValues()));
    setFields(_getInitialValues());
    touched.set(defaultTouched);

    function setCheckboxValues(target: HTMLInputElement) {
      const elPath = getPath(target);
      const checkboxes = Array.from(
        node.querySelectorAll(`[name="${target.name}"]`)
      ).filter((checkbox) => {
        if (!isFormControl(checkbox)) return false;
        return elPath === getPath(checkbox);
      });
      if (checkboxes.length === 0) return;
      if (checkboxes.length === 1) {
        return data.update(($data) =>
          _set($data, getPath(target), target.checked)
        );
      }
      return data.update(($data) => {
        return _set(
          $data,
          getPath(target),
          checkboxes
            .filter(isInputElement)
            .filter((el: HTMLInputElement) => el.checked)
            .map((el: HTMLInputElement) => el.value)
        );
      });
    }

    function setRadioValues(target: HTMLInputElement) {
      const radios = node.querySelectorAll(`[name="${target.name}"]`);
      const checkedRadio = Array.from(radios).find(
        (el) => isInputElement(el) && el.checked
      ) as HTMLInputElement | undefined;
      data.update(($data) => _set($data, getPath(target), checkedRadio?.value));
    }

    function setFileValue(target: HTMLInputElement) {
      const files = Array.from(target.files ?? []);
      data.update(($data) => {
        return _set($data, getPath(target), target.multiple ? files : files[0]);
      });
    }

    function setSelectValue(target: HTMLSelectElement) {
      if (!target.multiple) {
        data.update(($data) => {
          return _set($data, getPath(target), target.value);
        });
      } else {
        const selectedOptions = Array.from(target.options)
          .filter((opt) => opt.selected)
          .map((opt) => opt.value);
        data.update(($data) => {
          return _set($data, getPath(target), selectedOptions);
        });
      }
    }

    function handleInput(e: Event) {
      const target = e.target;
      if (
        !target ||
        !isFormControl(target) ||
        isSelectElement(target) ||
        shouldIgnore(target)
      )
        return;
      if (['checkbox', 'radio', 'file'].includes(target.type)) return;
      if (!target.name) return;
      isDirty.set(true);
      const inputValue = getInputTextOrNumber(target);
      interacted.set(target.name);
      data.update(($data) => {
        return _set($data, getPath(target), inputValue);
      });
    }

    function handleChange(e: Event) {
      const target = e.target;
      if (!target || !isFormControl(target) || shouldIgnore(target)) return;
      if (!target.name) return;
      setTouched<string, any>(getPath(target), true);
      interacted.set(target.name);
      if (
        isSelectElement(target) ||
        ['checkbox', 'radio', 'file', 'hidden'].includes(target.type)
      ) {
        isDirty.set(true);
      }
      if (target.type === 'hidden') {
        data.update(($data) => {
          return _set($data, getPath(target), target.value);
        });
      }
      if (isSelectElement(target)) setSelectValue(target);
      else if (!isInputElement(target)) return;
      else if (target.type === 'checkbox') setCheckboxValues(target);
      else if (target.type === 'radio') setRadioValues(target);
      else if (target.type === 'file') setFileValue(target);
    }

    function handleBlur(e: Event) {
      const target = e.target;
      if (!target || !isFormControl(target) || shouldIgnore(target)) return;
      if (!target.name) return;
      setTouched<string, any>(getPath(target), true);
      interacted.set(target.name);
    }

    function handleReset(e: Event) {
      e.preventDefault();
      reset();
    }

    const mutationOptions = { childList: true, subtree: true };

    function unsetTaggedForRemove(formControls: FormControl[]) {
      let currentData = get(data);
      let currentTouched = get(touched);
      let currentErrors = get(errors);
      let currentWarnings = get(warnings);
      for (const control of formControls.reverse()) {
        if (
          control.hasAttribute('data-felte-keep-on-remove') &&
          control.dataset.felteKeepOnRemove !== 'false'
        )
          continue;
        const fieldArrayReg = /.*(\[[0-9]+\]|\.[0-9]+)\.[^.]+$/;
        let fieldName = getPath(control);
        const shape = get(touched);
        const isFieldArray = fieldArrayReg.test(fieldName);
        if (isFieldArray) {
          const arrayPath = fieldName.split('.').slice(0, -1).join('.');
          const valueToRemove = _get(shape, arrayPath);
          if (
            _isPlainObject(valueToRemove) &&
            Object.keys(valueToRemove).length <= 1
          ) {
            fieldName = arrayPath;
          }
        }
        currentData = _unset(currentData, fieldName);
        currentTouched = _unset(currentTouched, fieldName);
        currentErrors = _unset(currentErrors, fieldName);
        currentWarnings = _unset(currentWarnings, fieldName);
      }
      data.set(currentData as Data);
      touched.set(currentTouched);
      errors.set(currentErrors);
      warnings.set(currentWarnings);
    }

    const updateAddedNodes = debounce(() => {
      _getCurrentExtenders().forEach((extender) => extender.destroy?.());
      _setCurrentExtenders(extender.map(callExtender('UPDATE')));
      const {
        defaultData: newDefaultData,
        defaultTouched: newDefaultTouched,
      } = getFormDefaultValues<Data>(node);
      data.update(($data) => _defaultsDeep<Data>($data, newDefaultData));
      touched.update(($touched) => {
        return _defaultsDeep($touched, newDefaultTouched);
      });
    }, 0);

    let removedFormControls: FormControl[] = [];

    const updateRemovedNodes = debounce(() => {
      _getCurrentExtenders().forEach((extender) => extender.destroy?.());
      _setCurrentExtenders(extender.map(callExtender('UPDATE')));
      unsetTaggedForRemove(removedFormControls);
      removedFormControls = [];
    }, 0);

    function handleNodeAddition(mutation: MutationRecord) {
      const shouldUpdate = Array.from(mutation.addedNodes).some((node) => {
        if (!isElement(node)) return false;
        if (isFormControl(node)) return true;
        const formControls = getFormControls(node);
        return formControls.length > 0;
      });
      if (!shouldUpdate) return;
      updateAddedNodes();
    }

    function handleNodeRemoval(mutation: MutationRecord) {
      for (const removedNode of mutation.removedNodes) {
        if (!isElement(removedNode)) continue;
        const formControls = getFormControls(removedNode);
        if (formControls.length === 0) continue;
        removedFormControls.push(...formControls);
        updateRemovedNodes();
      }
    }

    function mutationCallback(mutationList: MutationRecord[]) {
      for (const mutation of mutationList) {
        if (mutation.type !== 'childList') continue;
        if (mutation.addedNodes.length > 0) handleNodeAddition(mutation);
        if (mutation.removedNodes.length > 0) handleNodeRemoval(mutation);
      }
    }

    const observer = new MutationObserver(mutationCallback);

    observer.observe(node, mutationOptions);
    node.addEventListener('input', handleInput);
    node.addEventListener('change', handleChange);
    node.addEventListener('focusout', handleBlur);
    node.addEventListener('submit', handleSubmit);
    node.addEventListener('reset', handleReset);
    const unsubscribeErrors = errors.subscribe(($errors) => {
      for (const el of node.elements) {
        if (!isFormControl(el) || !el.name) continue;
        const fieldErrors = _get($errors, getPath(el));
        const message = Array.isArray(fieldErrors)
          ? fieldErrors.join('\n')
          : typeof fieldErrors === 'string'
          ? fieldErrors
          : undefined;
        if (message === el.dataset.felteValidationMessage) continue;
        if (message) {
          el.dataset.felteValidationMessage = message;
          el.setAttribute('aria-invalid', 'true');
        } else {
          delete el.dataset.felteValidationMessage;
          el.removeAttribute('aria-invalid');
        }
      }
    });

    return {
      destroy() {
        observer.disconnect();
        node.removeEventListener('input', handleInput);
        node.removeEventListener('change', handleChange);
        node.removeEventListener('focusout', handleBlur);
        node.removeEventListener('submit', handleSubmit);
        node.removeEventListener('reset', handleReset);
        unsubscribeErrors();
        _getCurrentExtenders().forEach((extender) => extender.destroy?.());
      },
    };
  }

  return { form };
}
