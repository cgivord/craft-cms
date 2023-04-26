import {browserSupportsWebAuthn} from '@simplewebauthn/browser';

/** global: Craft */
/** global: Garnish */
/**
 * AuthManager class
 */
Craft.AuthManager = Garnish.Base.extend(
  {
    remainingSessionTime: null,
    checkRemainingSessionTimer: null,
    showLoginModalTimer: null,
    decrementLogoutWarningInterval: null,

    showingLogoutWarningModal: false,
    showingLoginModal: false,

    logoutWarningModal: null,
    loginModal: null,

    $logoutWarningPara: null,
    $passwordInput: null,
    $loginBtn: null,
    $loginErrorPara: null,

    submitLoginIfLoggedOut: false,

    loginWithPassword: true,
    loginWithSecurityKey: false,
    mfaFlow: false,
    mfa: null,
    $alternativeLoginLink: null,

    /**
     * Init
     */
    init: function () {
      if (Craft.username) {
        this.updateRemainingSessionTime(Craft.remainingSessionTime);
      }
    },

    /**
     * Sets a timer for the next time to check the auth timeout.
     */
    setCheckRemainingSessionTimer: function (seconds) {
      if (this.checkRemainingSessionTimer) {
        clearTimeout(this.checkRemainingSessionTimer);
      }

      this.checkRemainingSessionTimer = setTimeout(
        this.checkRemainingSessionTime.bind(this),
        seconds * 1000
      );
    },

    /**
     * Pings the server to see how many seconds are left on the current user session, and handles the response.
     */
    checkRemainingSessionTime: function (extendSession) {
      $.ajax({
        url: Craft.getActionUrl(
          'users/session-info',
          extendSession ? null : 'dontExtendSession=1'
        ),
        type: 'GET',
        dataType: 'json',
        complete: (jqXHR, textStatus) => {
          if (textStatus === 'success') {
            if (
              typeof jqXHR.responseJSON.csrfTokenValue !== 'undefined' &&
              typeof Craft.csrfTokenValue !== 'undefined'
            ) {
              Craft.csrfTokenValue = jqXHR.responseJSON.csrfTokenValue;
            }

            this.updateRemainingSessionTime(jqXHR.responseJSON.timeout);
            this.submitLoginIfLoggedOut = false;
          } else {
            this.updateRemainingSessionTime(-1);
          }
        },
      });
    },

    /**
     * Updates our record of the auth timeout, and handles it.
     */
    updateRemainingSessionTime: function (remainingSessionTime) {
      this.remainingSessionTime = parseInt(remainingSessionTime);

      // Are we within the warning window?
      if (
        this.remainingSessionTime !== -1 &&
        this.remainingSessionTime < Craft.AuthManager.minSafeSessionTime
      ) {
        // Is there still time to renew the session?
        if (this.remainingSessionTime) {
          if (!this.showingLogoutWarningModal) {
            // Show the warning modal
            this.showLogoutWarningModal();
          }

          // Will the session expire before the next checkup?
          if (this.remainingSessionTime < Craft.AuthManager.checkInterval) {
            if (this.showLoginModalTimer) {
              clearTimeout(this.showLoginModalTimer);
            }

            this.showLoginModalTimer = setTimeout(
              this.showLoginModal.bind(this),
              this.remainingSessionTime * 1000
            );
          }
        } else {
          if (this.showingLoginModal) {
            if (this.submitLoginIfLoggedOut) {
              if (this.loginWithSecurityKey) {
                this.webauthnLogin();
              } else if (this.loginWithPassword) {
                if (this.mfaFlow == true) {
                  this.mfaLogin();
                } else {
                  this.submitLogin();
                }
              }
            }
          } else {
            // Show the login modal
            this.showLoginModal();
          }
        }

        this.setCheckRemainingSessionTimer(Craft.AuthManager.checkInterval);
      } else {
        // Everything's good!
        this.hideLogoutWarningModal();
        this.hideLoginModal();

        // Will be be within the minSafeSessionTime before the next update?
        if (
          this.remainingSessionTime !== -1 &&
          this.remainingSessionTime <
            Craft.AuthManager.minSafeSessionTime +
              Craft.AuthManager.checkInterval
        ) {
          this.setCheckRemainingSessionTimer(
            this.remainingSessionTime - Craft.AuthManager.minSafeSessionTime + 1
          );
        } else {
          this.setCheckRemainingSessionTimer(Craft.AuthManager.checkInterval);
        }
      }
    },

    /**
     * Shows the logout warning modal.
     */
    showLogoutWarningModal: function () {
      var quickShow;

      if (this.showingLoginModal) {
        this.hideLoginModal(true);
        quickShow = true;
      } else {
        quickShow = false;
      }

      this.showingLogoutWarningModal = true;

      if (!this.logoutWarningModal) {
        let $form = $(
          '<form id="logoutwarningmodal" class="modal alert fitted"/>'
        );
        let $body = $('<div class="body"/>').appendTo($form);
        let $buttons = $('<div class="buttons right"/>').appendTo($body);
        let $logoutBtn = $('<button/>', {
          type: 'button',
          class: 'btn',
          text: Craft.t('app', 'Sign out now'),
        }).appendTo($buttons);
        let $renewSessionBtn = $('<button/>', {
          type: 'submit',
          class: 'btn submit',
          text: Craft.t('app', 'Keep me signed in'),
        }).appendTo($buttons);

        this.$logoutWarningPara = $('<p/>').prependTo($body);

        this.logoutWarningModal = new Garnish.Modal($form, {
          autoShow: false,
          closeOtherModals: false,
          hideOnEsc: false,
          hideOnShadeClick: false,
          shadeClass: 'modal-shade dark logoutwarningmodalshade',
          onFadeIn: function () {
            if (!Garnish.isMobileBrowser(true)) {
              // Auto-focus the renew button
              setTimeout(function () {
                $renewSessionBtn.trigger('focus');
              }, 100);
            }
          },
        });

        this.addListener($logoutBtn, 'activate', 'logout');
        this.addListener($form, 'submit', 'renewSession');
      }

      if (quickShow) {
        this.logoutWarningModal.quickShow();
      } else {
        this.logoutWarningModal.show();
      }

      this.updateLogoutWarningMessage();

      this.decrementLogoutWarningInterval = setInterval(
        this.decrementLogoutWarning.bind(this),
        1000
      );
    },

    /**
     * Updates the logout warning message indicating that the session is about to expire.
     */
    updateLogoutWarningMessage: function () {
      this.$logoutWarningPara.text(
        Craft.t('app', 'Your session will expire in {time}.', {
          time: Craft.secondsToHumanTimeDuration(this.remainingSessionTime),
        })
      );

      this.logoutWarningModal.updateSizeAndPosition();
    },

    decrementLogoutWarning: function () {
      if (this.remainingSessionTime > 0) {
        this.remainingSessionTime--;
        this.updateLogoutWarningMessage();
      }

      if (this.remainingSessionTime === 0) {
        clearInterval(this.decrementLogoutWarningInterval);
      }
    },

    /**
     * Hides the logout warning modal.
     */
    hideLogoutWarningModal: function (quick) {
      this.showingLogoutWarningModal = false;

      if (this.logoutWarningModal) {
        if (quick) {
          this.logoutWarningModal.quickHide();
        } else {
          this.logoutWarningModal.hide();
        }

        if (this.decrementLogoutWarningInterval) {
          clearInterval(this.decrementLogoutWarningInterval);
        }
      }
    },

    /**
     * Shows the login modal.
     */
    showLoginModal: function () {
      var quickShow;

      if (this.showingLogoutWarningModal) {
        this.hideLogoutWarningModal(true);
        quickShow = true;
      } else {
        quickShow = false;
      }

      this.showingLoginModal = true;

      if (!this.loginModal) {
        if (Craft.requireMfa) {
          if (Craft.userHasSecurityKeys && browserSupportsWebAuthn()) {
            this.loginWithPassword = false;
            this.loginWithSecurityKey = true;
          } else {
            this.loginWithPassword = true;
            this.loginWithSecurityKey = false;
          }
          this.mfaFlow = false;
          this.mfa = null;
        }

        var $form = $('<form id="loginmodal" class="modal alert fitted"/>'),
          $body = $(
            '<div class="body"><h2>' +
              Craft.t('app', 'Your session has ended.') +
              '</h2><p>' +
              Craft.t('app', 'Log back in.') +
              '</p></div>'
          ).appendTo($form),
          $inputContainer = $('<div class="inputcontainer">').appendTo($body),
          $additionalActionsContainer = $(
            '<div class="login-form-extra"/>'
          ).appendTo($body),
          $inputsFlexContainer = $('<div class="flex"/>').appendTo(
            $inputContainer
          ),
          $passwordContainer = $('<div class="flex-grow"/>').appendTo(
            $inputsFlexContainer
          ),
          $buttonContainer = $('<div/>').appendTo($inputsFlexContainer),
          $passwordWrapper = $('<div class="passwordwrapper"/>').appendTo(
            $passwordContainer
          );

        this.$passwordInput = $(
          '<input type="password" class="text password fullwidth" autocomplete="current-password" placeholder="' +
            Craft.t('app', 'Password') +
            '"/>'
        ).appendTo($passwordWrapper);

        this.$loginBtn = Craft.ui
          .createSubmitButton({
            class: 'disabled',
            label: Craft.t('app', 'Sign in'),
            spinner: true,
          })
          .attr('aria-disabled', 'true')
          .appendTo($buttonContainer);

        this.$loginBtn = new Garnish.MultiFunctionBtn(this.$loginBtn, {
          changeButtonText: false,
        });

        $('<div id="mfa-form"/>').insertAfter($inputContainer);

        if (this.loginWithSecurityKey) {
          this.$loginBtn.$btnLabel.text(
            Craft.t('app', 'Sign in with a security key')
          );
          this.$loginBtn.$btn
            .removeClass('disabled')
            .attr('aria-disabled', 'false');
          this.$passwordInput.parents('.flex-grow').hide();

          this.$alternativeLoginLink = Craft.ui
            .createButton({
              label: Craft.t('app', 'Use password to login'),
              type: 'button',
            })
            .appendTo($additionalActionsContainer);

          this.addListener(
            this.$alternativeLoginLink,
            'click',
            'onAlternativeLoginLink'
          );
        }

        this.$loginErrorPara = $('<p class="error"/>').appendTo($body);

        this.loginModal = new Garnish.Modal($form, {
          autoShow: false,
          closeOtherModals: false,
          hideOnEsc: false,
          hideOnShadeClick: false,
          shadeClass: 'modal-shade dark loginmodalshade',
          onFadeIn: () => {
            if (!Garnish.isMobileBrowser(true)) {
              // Auto-focus the password input
              setTimeout(() => {
                this.$passwordInput.trigger('focus');
              }, 100);
            }
          },
          onFadeOut: () => {
            this.$passwordInput.val('');
          },
        });

        new Craft.PasswordInput(this.$passwordInput, {
          onToggleInput: ($newPasswordInput) => {
            this.$passwordInput = $newPasswordInput;
          },
        });

        this.addListener(this.$passwordInput, 'input', 'validatePassword');
        this.addListener($form, 'submit', 'login');
      }

      if (quickShow) {
        this.loginModal.quickShow();
      } else {
        this.loginModal.show();
      }
    },

    onAlternativeLoginLink: function () {
      this.clearLoginError();

      this.loginWithPassword = !this.loginWithPassword;
      this.loginWithSecurityKey = !this.loginWithSecurityKey;

      this.$passwordInput.val('');
      this.$passwordInput.parents('.flex-grow').toggle();

      if (this.loginWithPassword) {
        this.$loginBtn.$btnLabel.text(Craft.t('app', 'Sign in'));
        this.$loginBtn.$btn.attr('aria-disabled', 'true').addClass('disabled');
        this.$alternativeLoginLink.text(
          Craft.t('app', 'Use a security key to login')
        );
      } else if (this.loginWithSecurityKey) {
        this.$loginBtn.$btnLabel.text(
          Craft.t('app', 'Sign in using a security key')
        );
        this.$loginBtn.$btn
          .attr('aria-disabled', 'false')
          .removeClass('disabled');
        this.$alternativeLoginLink.text(
          Craft.t('app', 'Use a password to login')
        );
      }
    },

    /**
     * Hides the login modal.
     */
    hideLoginModal: function (quick) {
      this.showingLoginModal = false;

      if (this.loginModal) {
        if (quick) {
          this.loginModal.quickHide();
        } else {
          this.loginModal.hide();
        }
        // reset the modal
        this.loginModal.destroy();
        this.loginModal = null;
      }
    },

    logout: function () {
      $.get({
        url: Craft.getActionUrl('users/logout'),
        dataType: 'json',
        success: () => {
          Craft.redirectTo('');
        },
      });
    },

    renewSession: function (ev) {
      if (ev) {
        ev.preventDefault();
      }

      this.hideLogoutWarningModal();
      this.checkRemainingSessionTime(true);
    },

    validatePassword: function () {
      if (this.$passwordInput.val().length >= 6) {
        this.$loginBtn.$btn.removeClass('disabled');
        this.$loginBtn.$btn.removeAttr('aria-disabled');
        return true;
      } else {
        this.$loginBtn.$btn.addClass('disabled');
        this.$loginBtn.$btn.attr('aria-disabled', 'true');
        return false;
      }
    },

    login: function (ev) {
      if (ev) {
        ev.preventDefault();
      }

      if (
        (this.loginWithPassword && this.validatePassword()) ||
        this.loginWithSecurityKey
      ) {
        if (typeof Craft.csrfTokenValue !== 'undefined') {
          // Check the auth status one last time before sending this off,
          // in case the user has already logged back in from another window/tab
          this.submitLoginIfLoggedOut = true;
          this.checkRemainingSessionTime();
        } else {
          if (this.loginWithSecurityKey) {
            this.webauthnLogin();
          } else if (this.mfaFlow) {
            this.mfaLogin();
          } else if (this.loginWithPassword) {
            this.submitLogin();
          }
        }
      }
    },

    webauthnLogin: function () {
      this.clearLoginError();
      this.$loginBtn.busyEvent();

      var data = {
        loginName: Craft.username,
      };

      new Craft.Auth2faLogin.startWebauthnLogin(data, true)
        .then((response) => {
          this.closeModal();
        })
        .catch((response) => {
          this.showLoginError(response.error);
        });
    },

    mfaLogin: function () {
      this.clearLoginError();

      var $mfaLoginContainer = $('#mfa-form');
      var $submitBtn = $mfaLoginContainer.find('#mfa-verify');
      $submitBtn.addClass('loading');

      new Craft.Auth2faLogin.submitMfaCode($mfaLoginContainer, true)
        .then((response) => {
          this.closeModal();
        })
        .catch((response) => {
          this.showLoginError(response.error);
        })
        .finally(() => {
          $submitBtn.removeClass('loading');
        });
    },

    submitLogin: function () {
      this.clearLoginError();
      this.$loginBtn.busyEvent();
      var data = {
        loginName: Craft.username,
        password: this.$passwordInput.val(),
      };

      Craft.sendActionRequest('POST', 'users/login', {data})
        .then((response) => {
          if (response.data.mfa !== undefined && response.data.mfa == true) {
            this.mfaFlow = true;
            this.mfa = new Craft.Auth2fa();
            if (this.$alternativeLoginLink !== null) {
              this.$alternativeLoginLink.remove();
            }
            $('.inputcontainer').remove();
            this.mfa.showMfaForm(response.data.mfaForm, $('#loginmodal'));
            this.loginModal.updateSizeAndPosition();
          } else {
            this.closeModal();
          }
        })
        .catch(({response}) => {
          this.showLoginError(response.data.message || null);
          Garnish.shake(this.loginModal.$container);

          if (!Garnish.isMobileBrowser(true)) {
            this.$passwordInput.trigger('focus');
          }
        });
    },

    showLoginError: function (error) {
      this.$loginBtn.failureEvent();

      if (error === null || typeof error === 'undefined') {
        error = Craft.t('app', 'A server error occurred.');
      }

      this.$loginErrorPara.text(error);
      this.loginModal.updateSizeAndPosition();
    },

    clearLoginError: function () {
      this.showLoginError('');
    },

    closeModal: function () {
      this.$loginBtn.successEvent();
      this.hideLoginModal();
      this.checkRemainingSessionTime();
    },
  },
  {
    checkInterval: 60,
    minSafeSessionTime: 120,
  }
);
